"""Application-owned shared memory, discovered through deferred function tools."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


MEMORY_INSTRUCTIONS = (
    "Shared memory tools are available: recall before assuming user preferences, "
    "and save only on explicit user request; if delegating, subagents do not have these tools."
)

MEMORY_TOOLS: list[dict[str, object]] = [
    {"type": "tool_search"},
    {
        "type": "function",
        "name": "recall_memory",
        "description": "Recall shared workbench memories matching text or tags.",
        "defer_loading": True,
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query", "limit"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "save_memory",
        "description": "Save a shared memory only when the user explicitly requests it.",
        "defer_loading": True,
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "minLength": 1, "maxLength": 4000},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["text", "tags"],
            "additionalProperties": False,
        },
    },
]


class MemoryStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"entries": [], "ledger": {}}
        return json.loads(self.path.read_text())

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            try:
                json.dump(data, handle)
                handle.flush()
                os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            finally:
                temporary.unlink(missing_ok=True)

    def save(
        self, session_id: str, turn_id: str, call_id: str, source_chat_id: str,
        arguments: object, redact: Callable[[str], str],
    ) -> dict[str, Any]:
        key = json.dumps([session_id, turn_id, call_id])
        with self.lock:
            data = self._read()
            if key in data["ledger"]:
                return data["ledger"][key]
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except ValueError:
                    arguments = None
            text = arguments.get("text") if isinstance(arguments, dict) else None
            tags = arguments.get("tags", []) if isinstance(arguments, dict) else []
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                result = {"success": False, "error": "Memory text must contain 1 to 4000 characters."}
            elif not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
                result = {"success": False, "error": "Memory tags must be an array of strings."}
            else:
                entry = {
                    "id": str(uuid4()), "text": redact(text.strip()),
                    "tags": [redact(tag) for tag in tags],
                    "source_chat_id": redact(source_chat_id),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                data["entries"].append(entry)
                result = {"success": True, "output": {"status": "created", "id": entry["id"]}}
            data["ledger"][key] = result
            self._write(data)
            return result

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return list(reversed(self._read()["entries"]))

    def delete(self, entry_id: str) -> bool:
        with self.lock:
            data = self._read()
            entries = [entry for entry in data["entries"] if entry["id"] != entry_id]
            if len(entries) == len(data["entries"]):
                return False
            data["entries"] = entries
            for result in data["ledger"].values():
                if result.get("output", {}).get("id") == entry_id:
                    result.update(success=False, error="Memory entry was deleted.",
                                  output={"status": "deleted", "id": entry_id})
            self._write(data)
            return True

    def recall(self, query: str, limit: int) -> list[dict[str, Any]]:
        query = query.casefold()
        return [entry for entry in self.list()
                if query in entry["text"].casefold()
                or any(query in tag.casefold() for tag in entry["tags"])][:max(1, min(limit, 20))]
