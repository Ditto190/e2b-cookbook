"""Coordinator-owned transcripts. Each atomic JSON file is one shared chat."""

from __future__ import annotations

import copy
import json
import queue
import re
import threading
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, SerializationInfo, StrictBool, field_serializer, field_validator

from mcp_servers import DEFAULT_MCP_SERVERS, normalize_servers, option_secrets


class ReasoningSummary(BaseModel):
    enabled: StrictBool = False


class Delegation(BaseModel):
    enabled: StrictBool = False
    max_agents: int = Field(default=3, ge=1, le=8, strict=True)


class MemoryCapability(BaseModel):
    enabled: StrictBool = False


class McpCapability(BaseModel):
    """Which MCP servers this chat attaches, and whether the model discovers
    their tools through tool search instead of carrying every schema."""

    servers: list[str] = Field(default_factory=lambda: list(DEFAULT_MCP_SERVERS))
    tool_search: StrictBool = True
    # Per-server config for catalog servers, `{label: {optionKey: value}}` —
    # API keys mostly. Real values leave this process only as the gateway
    # config inside the sandbox. Persisted records and public responses mask
    # them to `"•"`; saving credentials again is required after a restart.
    options: dict[str, dict[str, str]] = Field(default_factory=dict)

    @field_validator("servers")
    @classmethod
    def known_servers(cls, value: list[str]) -> list[str]:
        return normalize_servers(value)

    @field_validator("options")
    @classmethod
    def clean_options(cls, value: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
        # A masked dump round-tripping through validation (archive → fork
        # record) must not turn the mask into a "value".
        cleaned = {
            label: {key: text.strip() for key, text in fields.items() if text.strip() and text != MASK}
            for label, fields in value.items()
        }
        return {label: fields for label, fields in cleaned.items() if fields}

    @field_serializer("options")
    def mask_options(self, value: dict[str, dict[str, str]], info: SerializationInfo) -> dict[str, dict[str, str]]:
        if (info.context or {}).get("secrets"):
            return value
        return {label: {key: MASK for key in fields} for label, fields in value.items()}

    def secret_values(self) -> list[str]:
        return option_secrets(self.options)


MASK = "•"


class Capabilities(BaseModel):
    delegation: Delegation = Field(default_factory=Delegation)
    mcp: McpCapability = Field(default_factory=McpCapability)
    memory: MemoryCapability = Field(default_factory=MemoryCapability)
    reasoning_summary: ReasoningSummary = Field(default_factory=ReasoningSummary)


class Activity(BaseModel):
    agent_id: str | None = None
    id: str | None = None
    tone: str
    label: str
    detail: str | None = None
    durationMs: float | None = None
    linkChatId: str | None = None


class InputTokenDetails(BaseModel):
    cached_tokens: int | None = Field(default=None, exclude_if=lambda v: v is None)


class OutputTokenDetails(BaseModel):
    reasoning_tokens: int | None = Field(default=None, exclude_if=lambda v: v is None)


class TokenUsage(BaseModel):
    input_tokens: int | None = Field(default=None, exclude_if=lambda v: v is None)
    input_tokens_details: InputTokenDetails | None = Field(default=None, exclude_if=lambda v: v is None)
    output_tokens: int | None = Field(default=None, exclude_if=lambda v: v is None)
    output_tokens_details: OutputTokenDetails | None = Field(default=None, exclude_if=lambda v: v is None)
    total_tokens: int | None = Field(default=None, exclude_if=lambda v: v is None)


class Interjection(BaseModel):
    submission_id: str
    text: str
    status: Literal["sending", "posted", "confirmed", "became_turn", "unconfirmed", "refused", "cancelled"]
    at: float
    by: str
    detail: str | None = None
    text_offset: int | None = Field(default=None, ge=0)


class Turn(BaseModel):
    id: int
    upstreamTurnId: str | None = Field(default=None, exclude_if=lambda v: v is None)
    usage: TokenUsage | None = Field(default=None, exclude_if=lambda v: v is None)
    prompt: str
    phase: str | None = None
    activities: list[Activity] = Field(default_factory=list)
    text: str
    reasoning: str | None = None
    outcome: Literal["running", "done", "cancelled", "error"]
    error: str | None = None
    errorCode: str | None = None
    forkable: bool | None = None
    terminal: bool | None = None
    interjections: list[Interjection] = Field(default_factory=list)
    from_submission_id: str | None = None


class ArchivedChat(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{4,80}$")
    title: str
    createdAt: float
    updatedAt: float
    turns: list[Turn]
    capabilities: Capabilities = Field(default_factory=Capabilities)
    expired: bool = False
    forkable: bool = False
    sandboxId: str | None = None
    sessionId: str | None = None
    parentChatId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{4,80}$")


class ChatHistory:
    def __init__(self, directory: Path):
        self.directory = directory
        self.lock = threading.RLock()
        self.records: dict[str, dict[str, Any]] = {}
        self.last_write: dict[str, float] = {}
        for path in directory.glob("*.json"):
            record = ArchivedChat.model_validate_json(path.read_text()).model_dump()
            self.records[record["id"]] = record
            # No worker survives a process restart. Preserve partial output.
            interrupted = False
            for turn in record["turns"]:
                for row in turn.get("interjections", []):
                    if row["status"] in {"sending", "posted"}:
                        row.update(
                            status="unconfirmed",
                            detail="The coordinator restarted before application could be verified.",
                        )
                        interrupted = True
                if turn["outcome"] == "running":
                    turn.update(
                        outcome="error",
                        phase=None,
                        error="The coordinator restarted during this turn.",
                    )
                    interrupted = True
            if interrupted:
                self._write(record)

    def _write(self, record: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / f"{record['id']}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=False))
        temporary.replace(path)
        self.last_write[record["id"]] = time.monotonic()

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return copy.deepcopy(
                sorted(
                    self.records.values(),
                    key=lambda row: row["updatedAt"],
                    reverse=True,
                )
            )

    def get(self, chat_id: str) -> dict[str, Any] | None:
        with self.lock:
            return copy.deepcopy(self.records.get(chat_id))

    def interjection(self, chat_id: str, submission_id: str) -> dict[str, Any] | None:
        with self.lock:
            for turn in self.records.get(chat_id, {}).get("turns", []):
                for row in turn.get("interjections", []):
                    if row["submission_id"] == submission_id:
                        return copy.deepcopy(row)
        return None

    def import_chat(self, record: ArchivedChat) -> None:
        with self.lock:
            if record.id in self.records:
                return
            data = record.model_dump()
            for turn in data["turns"]:
                if turn["outcome"] == "running":
                    turn.update(
                        outcome="error",
                        phase=None,
                        error="The browser disconnected during this turn.",
                    )
            self._write(data)
            self.records[record.id] = data

    def begin(self, chat_id: str, prompt: str) -> None:
        with self.lock:
            now = time.time() * 1000
            record = copy.deepcopy(self.records.get(chat_id)) or {
                "id": chat_id,
                "title": prompt[:80],
                "createdAt": now,
                "updatedAt": now,
                "turns": [],
            }
            record["updatedAt"] = now
            record["turns"].append(
                {
                    "id": max((turn["id"] for turn in record["turns"]), default=0) + 1,
                    "prompt": prompt,
                    "text": "",
                    "reasoning": None,
                    "phase": "Starting agent",
                    "activities": [],
                    "outcome": "running",
                }
            )
            self._write(record)
            self.records[chat_id] = record

    def apply(self, chat_id: str, item: dict[str, Any]) -> None:
        with self.lock:
            record = self.records.get(chat_id)
            if not record or not record["turns"]:
                return
            turn = record["turns"][-1]
            kind = item["type"]
            if kind in ("done", "cancelled", "error", "usage") and item.get("turn_id"):
                upstream_id = item["turn_id"]
                existing = next(
                    (row for row in record["turns"] if row.get("upstreamTurnId") == upstream_id),
                    None,
                )
                if kind == "usage" and existing is None:
                    return
                turn = existing if existing is not None else turn
                turn["upstreamTurnId"] = upstream_id
                if "usage" in item:
                    turn["usage"] = item["usage"]


            if kind == "turn_started":
                if item.get("previous_turn_id"):
                    turn["upstreamTurnId"] = item["previous_turn_id"]
                if item.get("previous_usage") is not None:
                    turn["usage"] = item["previous_usage"]
                turn.update(outcome=item["previous_outcome"], phase=None)
                if item.get("previous_error"):
                    turn["error"] = item["previous_error"]
                self.begin(chat_id, item["prompt"])
                self.records[chat_id]["turns"][-1]["from_submission_id"] = item["from_submission_id"]
                self._write(self.records[chat_id])
                return
            if kind == "interjection":
                row = {key: value for key, value in item.items() if key != "type"}
                for owner in record["turns"]:
                    rows = owner.setdefault("interjections", [])
                    for index, old in enumerate(rows):
                        if old["submission_id"] == row["submission_id"]:
                            rows[index] = row
                            self._write(record)
                            return
                turn.setdefault("interjections", []).append(row)
                self._write(record)
            elif kind == "state":
                turn["phase"] = item["message"]
            elif kind == "delta":
                turn["text"] += item["text"]
            elif kind == "text":
                turn["text"] = item["text"]
            elif kind == "reasoning":
                turn["reasoning"] = (
                    item["text"] if "text" in item
                    else (turn.get("reasoning") or "") + item["delta"]
                )
            elif kind == "activity":
                row = {
                    "id": item.get("id"),
                    "tone": item["tone"],
                    "label": item["label"],
                    "detail": item.get("detail"),
                    "durationMs": item.get("duration_ms"),
                    "agent_id": item.get("agent_id"),
                }
                rows = turn["activities"]
                index = next(
                    (
                        i
                        for i, old in enumerate(rows)
                        if row["id"] and old.get("id") == row["id"]
                    ),
                    None,
                )
                if index is None:
                    rows.append(row)
                else:
                    rows[index] = row
                turn["phase"] = None
            elif kind in ("done", "cancelled", "error"):
                turn.update(outcome=kind, phase=None)
                if kind == "error":
                    turn.update(
                        error=item["message"],
                        errorCode=item.get("code"),
                        forkable=item.get("forkable"),
                        terminal=item.get("terminal"),
                    )
                    if item.get("code") == "expired":
                        record.update(
                            expired=True, forkable=item.get("forkable", False)
                        )
            elif kind == "stream_end" and turn["outcome"] == "running":
                turn.update(
                    outcome="error",
                    phase=None,
                    error="The event stream ended unexpectedly.",
                )
            if (
                kind in ("done", "cancelled", "error", "usage", "stream_end")
                or time.monotonic() - self.last_write.get(chat_id, 0) >= 0.4
            ):
                self._write(record)

    def metadata(self, chat_id: str, **fields: Any) -> None:
        with self.lock:
            if record := self.records.get(chat_id):
                record.update(fields)
                self._write(record)

    def delete(self, chat_id: str) -> None:
        if re.fullmatch(r"[A-Za-z0-9_-]{4,80}", chat_id) is None:
            raise ValueError("Invalid chat ID")
        with self.lock:
            (self.directory / f"{chat_id}.json").unlink(missing_ok=True)
            self.records.pop(chat_id, None)
            self.last_write.pop(chat_id, None)

    def prepare_fork(
        self,
        parent_id: str,
        child_id: str,
        *,
        parent_chat_id: str | None,
        sandbox_id: str | None,
        session_id: str | None,
        sibling: bool,
    ) -> dict[str, Any]:
        with self.lock:
            parent = self.records.get(parent_id)
            now = time.time() * 1000
            child = {
                "id": child_id,
                "title": parent["title"] if parent else child_id,
                "createdAt": now,
                "updatedAt": now,
                "turns": copy.deepcopy(parent["turns"]) if parent else [],
                "capabilities": copy.deepcopy(
                    (parent or {}).get("capabilities", Capabilities().model_dump())
                ),
                "parentChatId": parent_chat_id,
                "sandboxId": sandbox_id,
                "sessionId": session_id,
            }
            self._note(
                child,
                "Recovered from sandbox" if sibling else "Forked from sandbox",
                (parent or {}).get("sandboxId") or parent_id,
                None if sibling else parent_id,
            )
            return child

    def save_fork(
        self, parent_id: str, child: dict[str, Any], *, promote: bool, sibling: bool
    ) -> None:
        with self.lock:
            parent = self.records.get(parent_id)
            child_id = child["id"]
            self._write(child)
            self.records[child_id] = copy.deepcopy(child)
            if sibling:
                for record in self.records.values():
                    if record.get("parentChatId") == parent_id:
                        record["parentChatId"] = child_id
                        self._write(record)
            elif parent:
                self._note(
                    parent,
                    "Promoted to sandbox" if promote else "Forked to sandbox",
                    child.get("sandboxId") or child_id,
                    child_id,
                )
                self._write(parent)

    @staticmethod
    def _note(
        record: dict[str, Any], label: str, detail: str, link: str | None
    ) -> None:
        record["turns"].append(
            {
                "id": max((turn["id"] for turn in record["turns"]), default=0) + 1,
                "prompt": "",
                "phase": None,
                "text": "",
                "reasoning": None,
                "outcome": "done",
                "activities": [
                    {
                        "tone": "muted",
                        "label": label,
                        "detail": detail,
                        "linkChatId": link,
                    }
                ],
            }
        )


class HistoryQueue(queue.Queue[dict[str, object]]):
    """Persist at the producer, independently of whether an SSE reader exists."""

    def __init__(self, history: ChatHistory, chat_id: str):
        super().__init__()
        self.history = history
        self.chat_id = chat_id
        self.terminal = False

    def put(
        self, item: dict[str, object], block: bool = True, timeout: float | None = None
    ) -> None:
        # A deferred usage lookup may outlive this turn's lock. Its EOF must
        # not mark a newer prompt as interrupted.
        if item["type"] != "stream_end" or not self.terminal:
            self.history.apply(self.chat_id, item)
        if item["type"] in ("done", "cancelled", "error"):
            self.terminal = True
        super().put(item, block, timeout)
