"""Bounded, thread-safe per-chat log history for browser SSE subscribers."""

from __future__ import annotations

import re
import secrets
import threading
from collections.abc import Callable, Iterable
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import islice
from typing import Literal

LogSource = Literal["backend", "executor", "agents_command"]
LogStream = Literal["stdout", "stderr", "combined"]

_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*=\s*([^\s]+)"
)
_BEARER = re.compile(r"(?i)(authorization\s*:\s*bearer\s+)([^\s]+)")


@dataclass(frozen=True, slots=True)
class LogRecord:
    seq: int
    at: str
    source: LogSource
    stream: LogStream
    text: str
    turn_id: str | None = None
    item_id: str | None = None
    output_index: int | None = None

    def payload(self, stream_id: str) -> dict[str, object]:
        return {
            "type": "log",
            "stream_id": stream_id,
            "cursor": self.seq,
            "seq": self.seq,
            "at": self.at,
            "source": self.source,
            "stream": self.stream,
            "text": self.text,
            "turn_id": self.turn_id,
            "item_id": self.item_id,
            "output_index": self.output_index,
        }


@dataclass(frozen=True, slots=True)
class LogRead:
    records: tuple[LogRecord, ...]
    gap_through: int | None
    closed_reason: str | None


class SecretStreamRedactor:
    """Scrubs every configured secret from a chunked stream. Multiple secrets
    because a chat holds two distinct OpenAI keys (dispatcher + executor) and
    either may surface in executor output."""

    def __init__(self, *redact: str) -> None:
        self.secrets = tuple(dict.fromkeys(s for s in redact if s))
        # Longest secret bounds how much tail must stay buffered for a match
        # that straddles two chunks.
        self.window = max((len(s) for s in self.secrets), default=0)
        self.buffer = ""

    def _scrub(self, text: str) -> str:
        for secret in self.secrets:
            text = text.replace(secret, "[redacted]")
        return text

    def feed(self, chunk: str) -> str:
        if not self.secrets:
            return chunk
        self.buffer = self._scrub(self.buffer + chunk)
        safe_length = max(0, len(self.buffer) - self.window + 1)
        # Secrets cannot contain newlines, so complete lines are safe to release
        # immediately instead of making executor output lag by one callback.
        safe_length = max(safe_length, self.buffer.rfind("\n") + 1)
        result, self.buffer = self.buffer[:safe_length], self.buffer[safe_length:]
        return result

    def finish(self) -> str:
        result = self._scrub(self.buffer)
        self.buffer = ""
        return result


class ChatLog:
    """Shared retained history. Publishers never wait for subscribers."""

    def __init__(
        self,
        *redact: str,
        more: Callable[[], Iterable[str]] | None = None,
        max_records: int = 2_000,
        max_bytes: int = 1_000_000,
        max_line_bytes: int = 16_384,
    ) -> None:
        # `more` is polled when a channel's redactor is built, for secrets the
        # owner only learns later (a chat's MCP option values).
        self._more = more
        self._condition = threading.Condition()
        self.stream_id = secrets.token_urlsafe(9)
        self._records: deque[LogRecord] = deque()
        self._bytes = 0
        self._next_seq = 1
        self._secrets = tuple(redact)
        self._max_records = max_records
        self._max_bytes = max_bytes
        self._max_line_bytes = max_line_bytes
        self._redactors: dict[str, SecretStreamRedactor] = {}
        self._line_buffers: dict[str, str] = {}
        self._closed_reason: str | None = None

    def publish(
        self,
        *,
        source: LogSource,
        stream: LogStream,
        text: str,
        channel: str,
        turn_id: str | None = None,
        item_id: str | None = None,
        output_index: int | None = None,
        final: bool = False,
    ) -> None:
        if not text and not final:
            return
        with self._condition:
            if self._closed_reason is not None:
                return
            redactor = self._redactors.get(channel)
            if redactor is None:
                redactor = self._redactors[channel] = SecretStreamRedactor(
                    *self._secrets, *(self._more() if self._more else ()))
            safe = redactor.feed(text)
            if final:
                safe += redactor.finish()
                self._redactors.pop(channel, None)
            buffered = self._line_buffers.get(channel, "") + safe
            lines = buffered.splitlines(keepends=True)
            trailing = ""
            if lines and not lines[-1].endswith(("\n", "\r")):
                trailing = lines.pop()
            if final and trailing:
                lines.append(trailing)
                trailing = ""
            elif len(trailing.encode("utf-8")) >= self._max_line_bytes:
                lines.append(trailing)
                trailing = ""
            self._line_buffers[channel] = trailing
            if final:
                self._line_buffers.pop(channel, None)
            for line in lines:
                clean = self._redact_patterns(line.rstrip("\r\n"))
                self._append_line(
                    source=source,
                    stream=stream,
                    text=clean,
                    turn_id=turn_id,
                    item_id=item_id,
                    output_index=output_index,
                )
            if lines:
                self._condition.notify_all()

    def publish_message(
        self,
        text: str,
        *,
        source: LogSource = "backend",
        stream: LogStream = "stderr",
    ) -> None:
        channel = f"message:{time.monotonic_ns()}"
        self.publish(
            source=source,
            stream=stream,
            text=text,
            channel=channel,
            final=True,
        )

    def latest_seq(self) -> int:
        with self._condition:
            return self._next_seq - 1

    def wait_after(self, cursor: int, timeout: float = 15) -> LogRead:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                first_seq = self._records[0].seq if self._records else self._next_seq
                gap_through = first_seq - 1 if cursor < first_seq - 1 else None
                count = max(0, self._next_seq - 1 - cursor)
                records = tuple(reversed(tuple(islice(reversed(self._records), count))))
                if records or gap_through is not None or self._closed_reason is not None:
                    return LogRead(records, gap_through, self._closed_reason)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return LogRead((), None, None)
                self._condition.wait(remaining)

    def recent_text(self, *, source: LogSource, stream: LogStream, limit: int) -> str:
        if limit <= 0:
            return ""
        with self._condition:
            lines: list[str] = []
            length = 0
            for record in reversed(self._records):
                if record.source == source and record.stream == stream:
                    lines.append(record.text)
                    length += len(record.text) + 1
                    if length > limit:
                        break
        return "\n".join(reversed(lines))[-limit:]

    def clear(self) -> None:
        with self._condition:
            self._records.clear()
            self._bytes = 0
            self._redactors.clear()
            self._line_buffers.clear()
            self._condition.notify_all()

    def close(self, reason: str) -> None:
        with self._condition:
            if self._closed_reason is None:
                self._closed_reason = reason
                self._condition.notify_all()

    def _append_line(
        self,
        *,
        source: LogSource,
        stream: LogStream,
        text: str,
        turn_id: str | None,
        item_id: str | None,
        output_index: int | None,
    ) -> None:
        encoded = text.encode("utf-8")
        if len(encoded) > self._max_line_bytes:
            text = encoded[: self._max_line_bytes].decode("utf-8", errors="ignore") + "…"
            encoded = text.encode("utf-8")
        record = LogRecord(
            seq=self._next_seq,
            at=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            source=source,
            stream=stream,
            text=text,
            turn_id=turn_id,
            item_id=item_id,
            output_index=output_index,
        )
        self._next_seq += 1
        self._records.append(record)
        self._bytes += len(encoded)
        while self._records and (
            len(self._records) > self._max_records or self._bytes > self._max_bytes
        ):
            removed = self._records.popleft()
            self._bytes -= len(removed.text.encode("utf-8"))

    @staticmethod
    def _redact_patterns(text: str) -> str:
        text = _BEARER.sub(r"\1[redacted]", text)
        return _SECRET_ASSIGNMENT.sub(r"\1=[redacted]", text)
