from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True)
class ServerSentEvent:
    event: str
    data: str
    event_id: str | None


async def aiter_sse(lines: AsyncIterator[str]) -> AsyncIterator[ServerSentEvent]:
    event_type = "message"
    event_id: str | None = None
    data_lines: list[str] = []
    async for raw_line in lines:
        line = raw_line.rstrip("\r")
        if line == "":
            if data_lines:
                yield ServerSentEvent(
                    event=event_type,
                    data="\n".join(data_lines),
                    event_id=event_id,
                )
            event_type = "message"
            event_id = None
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "event":
            event_type = value
        elif field == "data":
            data_lines.append(value)
        elif field == "id":
            event_id = value
    if data_lines:
        yield ServerSentEvent(
            event=event_type,
            data="\n".join(data_lines),
            event_id=event_id,
        )
