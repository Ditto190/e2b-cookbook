import asyncio
import json
import os
import queue
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from unittest.mock import AsyncMock, patch

import httpx
from e2b import CommandExitException

import app
import mcp_servers


HTML = "Created index.html:\n```html\n<h1>Hello</h1>\n```"
SESSION = {
    "id": "sess_test", "object": "agent.session", "created_at": 1,
    "last_active_at": 1, "status": "in_progress", "agent": {},
    "environment": {"type": "none"},
}


def frame(kind, **fields):
    return {
        "type": kind, "event_id": f"event_{kind}",
        "session_id": "sess_test", "turn_id": "turn_test", **fields,
    }


def text_frame(kind, text):
    return frame(
        f"session.turn.output_text.{kind}", item_id="message_test",
        output_index=0, content_index=0,
        **{"delta" if kind == "delta" else "text": text},
    )


def reasoning_frame(kind, *, index=0, item_id="reasoning_test", **fields):
    return frame(f"session.turn.reasoning_summary_{kind}", item_id=item_id,
                 output_index=0, summary_index=index, **fields)


def subagent_frame(kind, agent_id, turn_id=None):
    return frame(f"session.subagent.{kind}", turn_id=turn_id, subagent={
        "id": agent_id, "object": "session.subagent", "session_id": "sess_test",
        "name": "Reviewer", "instructions": None, "parent_agent_id": "root",
        "status": "closed" if kind == "closed" else "active",
        "opened_at": 1, "closed_at": 2 if kind == "closed" else None,
    })


def command_frame(kind, turn_id, item_id, command="pwd", **fields):
    return frame(f"session.turn.item.{kind}", turn_id=turn_id, item={
        "type": "command_execution", "id": item_id, "command": command, **fields,
    })


class EventBody(httpx.AsyncByteStream):
    def __init__(self, events, *, hang=False, disconnect=False):
        self.events = events
        self.hang = hang
        self.disconnect = disconnect
        self.closed = False

    async def __aiter__(self):
        for event in self.events:
            yield f"data: {json.dumps(event)}\n\n".encode()
        if self.disconnect:
            raise httpx.RemoteProtocolError("incomplete response body")
        if self.hang:
            await asyncio.Future()

    async def aclose(self):
        self.closed = True


class StreamingTest(unittest.IsolatedAsyncioTestCase):
    async def run_turn(self, bodies, *, turn_status="completed", error=None,
                       usage=None, guarded=False, on_retrieve=None, capabilities=None, required_actions=None,
                       usage_responses=None):
        self.requests = []
        self.payloads = []
        sync_history = AsyncMock()
        self.bodies = bodies
        streams = iter(bodies)
        responses = iter(usage_responses) if usage_responses is not None else None

        async def handle(request):
            path = request.url.path
            self.requests.append((request.method, path))
            if request.content:
                self.payloads.append(json.loads(request.content))
            if path.endswith("/events"):
                if request.method == "POST":
                    sync_history.assert_awaited_once()
                    return httpx.Response(202)
                return httpx.Response(200, stream=next(streams), headers={
                    "Content-Type": "text/event-stream", "x-request-id": "request-test",
                })
            if path.endswith("/turns/turn_test"):
                if on_retrieve:
                    await on_retrieve(output)
                return httpx.Response(200, json={
                    "id": "turn_test", "object": "session.turn", "session_id": "sess_test",
                    "agent_id": "agent_test", "subagent_id": None, "status": turn_status,
                    "created_at": 1, "started_at": 1, "completed_at": 2,
                    "error": error, "usage": next(responses) if responses is not None else usage,
                })
            if path.endswith("/items"):
                return httpx.Response(200, json={
                    "data": [{"id": "message_test", "turn_id": "turn_test", "type": "message",
                              "role": "assistant", "status": "completed", "content": HTML}],
                    "has_more": False, "before": None, "after": None,
                })
            return httpx.Response(200, json={**SESSION, "required_actions": required_actions or []})

        real_client = httpx.AsyncClient
        def client(**kwargs):
            return real_client(transport=httpx.MockTransport(handle), **kwargs)

        demo = app.DemoSession(
            chat_id="chat-test", client_id="client-test", api_key="test-secret",
            session_id="sess_test", active=True, capabilities=app.Capabilities.model_validate(capabilities or {}),
        )
        self.demo = demo
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.history = app.ChatHistory(Path(directory.name))
        self.history.begin(demo.chat_id, "Create a tiny web page and print its HTML")
        output = app.HistoryQueue(self.history, demo.chat_id)
        if guarded:
            demo.turn_lock.acquire()
        with (
            patch.object(app.httpx, "AsyncClient", side_effect=client),
            patch.object(app, "ensure_executor", new=AsyncMock(return_value=True)),
            patch.object(app, "ensure_executor_running"),
            patch.object(app, "save_chat_record"),
            patch.object(app, "USAGE_RETRY_DELAYS_SECONDS", (0, 0, 0)),
            patch.object(app, "sync_executor_history", sync_history),
        ):
            try:
                runner = app.run_turn_guarded if guarded else app.run_turn
                await asyncio.wait_for(runner(demo, "Create a tiny web page and print its HTML", output), 2)
            finally:
                self.events = list(output.queue)
                self.assertTrue(all(body.closed for body in bodies))
        return self.events

    def rendered_text(self):
        text = ""
        for event in self.events:
            if event["type"] == "text":
                text = event["text"]
            elif event["type"] == "delta":
                text += event["text"]
        return text

    async def test_complete_text_repairs_missing_deltas_without_post_turn_polling(self):
        await self.run_turn([EventBody([
            frame("session.turn.created"), text_frame("delta", "Created "),
            text_frame("done", HTML), frame("session.turn.completed"),
            frame("session.idle", session={**SESSION, "status": "idle"}),
        ])])
        self.assertEqual(self.rendered_text(), HTML)
        self.assertEqual(self.events[-1]["type"], "done")
        self.assertEqual(self.requests.count(("GET", "/v1/agents/sessions/sess_test")), 1)

    async def test_eof_and_transport_error_recover_durable_output_with_stale_session_status(self):
        for disconnect in (False, True):
            with self.subTest(disconnect=disconnect):
                await self.run_turn([
                    EventBody([frame("session.turn.created"), text_frame("delta", "Created ")], disconnect=disconnect),
                    EventBody([], hang=True),
                ])
                self.assertEqual(self.rendered_text(), HTML)
                self.assertEqual(self.events[-1]["type"], "done")
                self.assertEqual(sum(m == "POST" for m, _ in self.requests), 1)
                self.assertFalse(any("preview API issue" in str(e) for e in self.events))

    async def test_failed_or_cancelled_turn_is_never_reported_as_success(self):
        for status in ("failed", "cancelled"):
            with self.subTest(status=status):
                bodies = [EventBody([frame("session.turn.created")]), EventBody([], hang=True)]
                if status == "failed":
                    await self.run_turn(bodies, turn_status=status, error={"code": "server_error", "message": "Tool failed"})
                    self.assertEqual(self.events[-1]["type"], "error")
                    self.assertIn("Tool failed", self.events[-1]["message"])
                else:
                    await self.run_turn(bodies, turn_status=status)
                    self.assertEqual(self.events[-1]["type"], "cancelled")
                self.assertNotIn("done", [e["type"] for e in self.events])

    async def test_active_turn_continues_from_buffered_live_events(self):
        await self.run_turn([
            EventBody([frame("session.turn.created"), text_frame("delta", "Created ")]),
            EventBody([text_frame("done", HTML), frame("session.turn.completed"),
                       frame("session.idle", session={**SESSION, "status": "idle"})]),
        ], turn_status="in_progress")
        self.assertEqual(self.rendered_text(), HTML)
        self.assertEqual(self.events[-1]["type"], "done")

    async def test_pending_memory_save_recovers_after_disconnect_and_stalls_remain_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "memory.json"
            with (
                patch.object(app, "memory_store", app.MemoryStore(path)),
                patch.object(app, "STREAM_STALL_SECONDS", 0.001),
                patch.object(app, "MAX_CONSECUTIVE_STALLS", 2),
                patch.object(app, "ensure_sandbox_running", new=AsyncMock()),
            ):
                with self.assertRaisesRegex(RuntimeError, "stalled repeatedly"):
                    await self.run_turn([
                        EventBody([frame("session.turn.created")], disconnect=True),
                        EventBody([], hang=True),
                    ], turn_status="in_progress", capabilities={"memory": {"enabled": True}}, required_actions=[{
                        "type": "function_call", "name": "save_memory", "call_id": "pending-save",
                        "turn_id": "turn_test", "arguments": {"text": "Recovered save", "tags": []},
                    }])
            stored = json.loads(path.read_text())
            self.assertEqual(len(stored["entries"]), 1)
            self.assertEqual(len(stored["ledger"]), 1)
            results = [event for payload in self.payloads for event in payload["events"]
                       if event["type"] == "session.input.tool_result"]
            self.assertEqual(len(results), 3)
            self.assertTrue(all(result == results[0] for result in results))
            self.assertEqual(results[0]["turn_id"], "turn_test")
            self.assertEqual(results[0]["call_id"], "pending-save")

    async def test_tool_handlers_survive_reconnect(self):
        handler = AsyncMock(return_value={"temperature": 20})
        with patch.object(app, "TOOL_HANDLERS", {"get_temperature": handler}):
            await self.run_turn([
                EventBody([frame("session.turn.created")]),
                EventBody([
                    frame("session.turn.item.added", item={
                        "type": "function_call", "name": "get_temperature",
                        "call_id": "call_test", "arguments": '{"city":"Prague"}',
                    }),
                    text_frame("done", HTML), frame("session.turn.completed"),
                    frame("session.idle", session={**SESSION, "status": "idle"}),
                ]),
            ], turn_status="in_progress")
        handler.assert_awaited_once_with({"city": "Prague"})
        self.assertEqual(sum(m == "POST" for m, _ in self.requests), 2)

    async def test_terminal_usage_is_sparse_and_archived_for_all_outcomes(self):
        for status, kind in (("completed", "done"), ("failed", "error"), ("cancelled", "cancelled")):
            with self.subTest(status=status):
                usage = {"input_tokens": 120, "input_tokens_details": {"cached_tokens": 20}}
                await self.run_turn([EventBody([
                    frame("session.turn.created"), text_frame("done", HTML),
                    frame(f"session.turn.{status}", usage=usage),
                    frame("session.idle", session={**SESSION, "status": "idle"}),
                ])], guarded=True)
                terminal = next(e for e in self.events if e["type"] == kind)
                self.assertEqual(terminal["usage"], usage)
                self.assertEqual(terminal["turn_id"], "turn_test")
                archive = self.history.get("chat-test")
                self.assertEqual(archive["turns"][0]["usage"], usage)
                self.assertEqual(archive["turns"][0]["upstreamTurnId"], "turn_test")
                self.assertEqual(archive["turns"][0]["outcome"], kind)
                self.assertFalse(any(e["type"] == "usage" for e in self.events))

    async def test_missing_terminal_usage_is_retrieved_only_after_outcome(self):
        for status, kind in (("completed", "done"), ("failed", "error"), ("cancelled", "cancelled")):
            with self.subTest(status=status):
                async def after_terminal(output):
                    terminal = next(e for e in output.queue if e["type"] == kind)
                    self.assertNotIn("usage", terminal)
                    self.assertFalse(self.demo.active)
                    self.assertFalse(self.demo.turn_lock.locked())
                    await asyncio.sleep(0)
                    self.assertEqual(self.history.get("chat-test")["turns"][0]["outcome"], kind)

                await self.run_turn([EventBody([
                    frame("session.turn.created"), text_frame("done", HTML),
                    frame(f"session.turn.{status}"),
                    frame("session.idle", session={**SESSION, "status": "idle"}),
                ])], guarded=True, usage={"output_tokens": 7}, on_retrieve=after_terminal)
                kinds = [e["type"] for e in self.events]
                self.assertLess(kinds.index(kind), kinds.index("usage"))
                self.assertEqual(self.events[-2], {"type": "usage", "turn_id": "turn_test", "usage": {"output_tokens": 7}})
                self.assertEqual(self.history.get("chat-test")["turns"][0]["usage"], {"output_tokens": 7})

    async def test_nested_terminal_usage_is_preserved_without_fallback_lookup(self):
        for status, kind in (("completed", "done"), ("failed", "error"), ("cancelled", "cancelled")):
            with self.subTest(status=status):
                usage = {"input_tokens": 120, "output_tokens": 9,
                         "input_tokens_details": {"cached_tokens": 20}}
                turn = {
                    "id": "turn_test", "object": "session.turn", "session_id": "sess_test",
                    "agent_id": "agent_test", "subagent_id": None, "status": status,
                    "created_at": 1, "started_at": 1, "completed_at": 2,
                    "error": None, "usage": usage,
                }
                await self.run_turn([EventBody([
                    frame("session.turn.created"), text_frame("done", HTML),
                    frame(f"session.turn.{status}", turn=turn),
                ])], guarded=True)
                terminal = next(e for e in self.events if e["type"] == kind)
                self.assertEqual(terminal["usage"], usage)
                self.assertEqual(self.history.get("chat-test")["turns"][0]["usage"], usage)
                self.assertFalse(any("/turns/" in path for _, path in self.requests))

    async def test_delayed_usage_is_retried_after_completion_without_holding_turn_lock(self):
        for status, kind in (("completed", "done"), ("failed", "error"), ("cancelled", "cancelled")):
            with self.subTest(status=status):
                async def while_pending(output):
                    self.assertFalse(self.demo.turn_lock.locked())
                    self.assertFalse(self.demo.active)
                    self.assertEqual(self.history.get("chat-test")["turns"][0]["outcome"], kind)
                    self.assertTrue(any(e["type"] == kind for e in output.queue))

                usage = {"input_tokens": 9921, "output_tokens": 13, "total_tokens": 9934,
                         "input_tokens_details": {"cached_tokens": 0},
                         "output_tokens_details": {"reasoning_tokens": 0}}
                await self.run_turn([EventBody([
                    frame("session.turn.created"), text_frame("done", HTML),
                    frame(f"session.turn.{status}"),
                ])], guarded=True, usage_responses=[None, None, usage], on_retrieve=while_pending)
                self.assertEqual(self.requests.count(("GET", "/v1/agents/sessions/sess_test/turns/turn_test")), 3)
                updates = [e for e in self.events if e["type"] == "usage"]
                self.assertEqual(updates, [{"type": "usage", "turn_id": "turn_test", "usage": usage}])
                self.assertEqual(self.history.get("chat-test")["turns"][0]["usage"], usage)

    async def test_usage_retries_are_bounded_when_counters_never_arrive(self):
        await self.run_turn([EventBody([
            frame("session.turn.created"), text_frame("done", HTML),
            frame("session.turn.completed"),
        ])], guarded=True)
        self.assertEqual(self.requests.count(("GET", "/v1/agents/sessions/sess_test/turns/turn_test")), 3)
        self.assertEqual([e["type"] for e in self.events][-2:], ["done", "stream_end"])
        self.assertNotIn("usage", self.history.get("chat-test")["turns"][0])

    async def test_reconnect_archives_one_usage_and_preserves_it_on_reload_and_fork(self):
        usage = {"input_tokens": 100, "output_tokens": 30, "total_tokens": 130,
                 "input_tokens_details": {"cached_tokens": 50},
                 "output_tokens_details": {"reasoning_tokens": 10}}
        await self.run_turn([
            EventBody([frame("session.turn.created"), text_frame("delta", "Created ")], disconnect=True),
            EventBody([
                text_frame("done", HTML),
                frame("session.turn.completed", usage=usage),
                frame("session.turn.completed", usage=usage),
                frame("session.idle", session={**SESSION, "status": "idle"}),
            ]),
        ], turn_status="in_progress")
        reloaded = app.ChatHistory(self.history.directory)
        archive = reloaded.get("chat-test")
        self.assertEqual(len(archive["turns"]), 1)
        self.assertEqual(archive["turns"][0]["usage"], usage)
        self.assertEqual(archive["turns"][0]["upstreamTurnId"], "turn_test")
        # A delayed duplicate is keyed to the original turn, even with a newer prompt.
        reloaded.begin("chat-test", "Next prompt")
        reloaded.apply("chat-test", {"type": "usage", "turn_id": "turn_test", "usage": usage})
        archive = reloaded.get("chat-test")
        self.assertEqual(sum("usage" in turn for turn in archive["turns"]), 1)
        self.assertNotIn("usage", archive["turns"][1])
        child = reloaded.prepare_fork("chat-test", "chat-child", parent_chat_id="chat-test",
                                     sandbox_id=None, session_id="sess_child", sibling=False)
        self.assertEqual(child["turns"][0]["usage"], usage)

    async def test_usage_lookup_failure_keeps_terminal_outcome(self):
        async def unavailable(output):
            self.assertEqual(list(output.queue)[-1]["type"], "done")
            raise httpx.ConnectError("lookup unavailable")

        await self.run_turn([EventBody([
            frame("session.turn.created"), text_frame("done", HTML),
            frame("session.turn.completed"),
            frame("session.idle", session={**SESSION, "status": "idle"}),
        ])], on_retrieve=unavailable, guarded=True)
        self.assertNotIn("error", [e["type"] for e in self.events])
        self.assertNotIn("usage", self.history.get("chat-test")["turns"][0])

    async def test_trace_url_requires_template_and_redacts_session_identity(self):
        demo = app.DemoSession(chat_id="chat-test", client_id="client-test",
                               api_key="secret-token", session_id="sess_secret-token")
        self.assertIsNone(app.session_snapshot(demo)["trace_url"])
        self.assertIsNone(app.session_snapshot(None)["trace_url"])
        with patch.object(app, "TRACE_URL_TEMPLATE", "https://trace.example.test/{session_id}"):
            snapshot = app.session_snapshot(demo)
        self.assertEqual(snapshot["trace_url"], "https://trace.example.test/sess_[redacted]")
        self.assertEqual(snapshot["session_id"], "sess_[redacted]")
        with tempfile.TemporaryDirectory() as directory:
            history = app.ChatHistory(Path(directory) / "history")
            history.begin(demo.chat_id, "Prompt")
            with (patch.object(app, "chat_history", history),
                  patch.object(app, "STATE_FILE", Path(directory) / "state.json"),
                  patch.dict(app.chat_records, clear=True)):
                app.save_chat_record(demo)
            reloaded = app.ChatHistory(history.directory)
            self.assertEqual(reloaded.get(demo.chat_id)["sessionId"], "sess_[redacted]")

    async def test_terminal_without_idle_emits_outcome_before_usage_lookup(self):
        async def after_terminal(output):
            self.assertEqual(list(output.queue)[-1]["type"], "done")

        await self.run_turn([EventBody([
            frame("session.turn.created"), text_frame("done", HTML),
            frame("session.turn.completed"),
        ], disconnect=True)], guarded=True, usage={"input_tokens": 9}, on_retrieve=after_terminal)
        self.assertEqual([e["type"] for e in self.events][-3:], ["done", "usage", "stream_end"])

    async def test_deferred_usage_and_eof_do_not_change_a_newer_active_turn(self):
        async def begin_next_turn(output):
            self.assertTrue(self.demo.turn_lock.acquire(blocking=False))
            self.addCleanup(self.demo.turn_lock.release)
            self.demo.active = True
            self.demo.active_turn_id = "turn_next"
            self.demo.cancel_requested.set()
            self.history.begin("chat-test", "Next prompt")

        await self.run_turn([EventBody([
            frame("session.turn.created"), text_frame("done", HTML),
            frame("session.turn.completed"),
        ])], guarded=True, usage={"output_tokens": 4}, on_retrieve=begin_next_turn)
        self.assertTrue(self.demo.active)
        self.assertTrue(self.demo.turn_lock.locked())
        self.assertTrue(self.demo.cancel_requested.is_set())
        self.assertEqual(self.demo.active_turn_id, "turn_next")
        turns = self.history.get("chat-test")["turns"]
        self.assertEqual(turns[0]["usage"], {"output_tokens": 4})
        self.assertEqual(turns[1]["outcome"], "running")
        self.assertNotIn("usage", turns[1])


class CapabilityChatTest(unittest.TestCase):
    def setUp(self):
        # These fixtures never publish usage. Exercise the bounded retry path
        # without waiting through production backoff after every mocked turn.
        self.enterContext(patch.object(app, "USAGE_RETRY_DELAYS_SECONDS", (0, 0, 0)))
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.memory_path = Path(directory) / "shared-memory.json"
        self.enterContext(patch.object(app, "memory_store", app.MemoryStore(self.memory_path)))
        self.history_path = Path(directory) / "history"
        self.enterContext(patch.object(app, "chat_history", app.ChatHistory(self.history_path)))
        self.enterContext(patch.object(app, "STATE_FILE", Path(directory) / "state.json"))
        self.enterContext(patch.object(app, "sessions", {}))
        self.enterContext(patch.object(app, "chat_records", {}))
        self.enterContext(patch.object(app.auth, "auth_enabled", return_value=False))
        self.enterContext(patch.dict(os.environ, {"E2B_API_KEY": "fake-e2b"}))
        self.enterContext(patch.object(app, "DEFAULT_OPENAI_KEY", "test-secret"))
        self.enterContext(patch.object(app, "DEFAULT_EXECUTOR_KEY", "executor-secret"))
        self.enterContext(patch.object(app, "ensure_executor", new=AsyncMock(return_value=True)))
        self.enterContext(patch.object(app, "ensure_executor_running"))
        self.requests = []
        self.script = []
        self.turn_number = 0
        self.on_tool_result = None
        self.tool_result_failures = 0
        self.outcome = "completed"
        self.terminal_usage = None
        self.stream_bodies = None
        self.turn_lookups = {}
        self.session = {**SESSION, "environment": {
            "type": "self_hosted", "environment_id": "env_test",
        }}

        async def handle(request):
            payload = json.loads(request.content) if request.content else None
            self.requests.append((request.method, request.url.path, payload))
            if payload and self.on_tool_result and any(
                event["type"] == "session.input.tool_result" for event in payload.get("events", [])
            ):
                self.on_tool_result()
            if payload and self.tool_result_failures and any(
                event["type"] == "session.input.tool_result" for event in payload.get("events", [])
            ):
                self.tool_result_failures -= 1
                raise httpx.ReadError("tool result response lost")
            if request.url.path.endswith("/events"):
                if request.method == "POST":
                    return httpx.Response(202)
                if self.stream_bodies is not None:
                    return httpx.Response(200, stream=next(self.stream_bodies), headers={
                        "Content-Type": "text/event-stream",
                    })
                self.turn_number += 1
                events = [frame("session.turn.created"), *self.script,
                          text_frame("done", "Answer"), frame(f"session.turn.{self.outcome}", usage=self.terminal_usage),
                          frame("session.idle", session={**self.session, "status": "idle"})]
                return httpx.Response(200, stream=EventBody([
                    {**event, "turn_id": f"turn_{self.turn_number}"}
                    if event["turn_id"] == "turn_test" else event for event in events
                ]), headers={"Content-Type": "text/event-stream"})
            if "/turns/" in request.url.path:
                turn_id = request.url.path.rsplit("/", 1)[-1]
                lookup = self.turn_lookups.get(turn_id, {"subagent_id": None})
                if isinstance(lookup, list):
                    lookup = lookup.pop(0)
                if lookup == "hang":
                    await asyncio.sleep(0.1)
                    lookup = {"subagent_id": None}
                if lookup is None:
                    return httpx.Response(503, json={"error": {"message": "Lookup unavailable"}})
                return httpx.Response(200, json={
                    "id": turn_id, "object": "session.turn", "session_id": "sess_test",
                    "agent_id": "agent_test", "status": "in_progress", "created_at": 1,
                    "started_at": 1, "completed_at": None, "error": None, "usage": None,
                    **lookup,
                })
            if request.url.path.endswith("/items"):
                return httpx.Response(200, json={"data": [], "has_more": False,
                                                "before": None, "after": None})
            if request.method == "POST" and request.url.path.endswith("/sessions"):
                self.session = {**self.session, "agent": payload["agent"]}
            return httpx.Response(200, json=self.session)

        real_client = httpx.AsyncClient
        self.real_http_client = real_client
        self.enterContext(patch.object(app.httpx, "AsyncClient", side_effect=lambda **kwargs:
            real_client(transport=httpx.MockTransport(handle), **kwargs)))
        self.client = app.app.test_client()

    def send(self, chat_id="chat-cap", **fields):
        response = self.client.post("/api/chat", json={
            "client_id": "client-test", "chat_id": chat_id,
            "api_key": "test-secret", "prompt": "Hello", **fields,
        })
        self.assertEqual(response.status_code, 200)
        return [json.loads(line[6:]) for line in response.get_data(as_text=True).splitlines()
                if line.startswith("data: ")]

    def test_delegation_registry_counts_ids_and_duplicate_lifecycle_events(self):
        for resumed in (False, True):
            with self.subTest(resumed=resumed):
                self.script = [subagent_frame(kind, agent_id) for kind, agent_id in [
                    ("created", "a"), ("created", "a"), ("active", "a"), ("active", "a"),
                    ("created", "b"), ("closed", "a"), ("closed", "a"),
                    ("closed", "unseen"), ("created", "a"), ("active", "a"),
                ]]
                if resumed:
                    self.script += [
                        {**subagent_frame("active", "a"), "event_id": "fresh-resume"},
                        subagent_frame("closed", "a"),
                    ]
                chat_id = f"registry-{resumed}"
                events = self.send(chat_id=chat_id, capabilities={"delegation": {"enabled": True}})
                expected = {"open": 2 if resumed else 1, "known": True}
                self.assertEqual(events[-1]["session"]["subagents"], expected)
                status = self.client.get(f"/api/status?chat_id={chat_id}",
                                         headers={app.CLIENT_ID_HEADER: "client-test"}).get_json()
                self.assertEqual(status["subagents"], expected)

    def test_delegated_commands_use_one_lookup_and_archive_redacted_attribution(self):
        self.turn_lookups = {"child": {"subagent_id": "agent-test-secret"}}
        self.script = [
            frame("session.turn.created", turn_id="child"),
            command_frame("added", "child", "cmd", "echo executor-secret"),
            command_frame("done", "child", "cmd", "echo executor-secret", status="failed"),
            command_frame("done", "child", "cmd", "echo executor-secret", status="failed"),
            command_frame("done", "child", "next-cmd"),
            {**text_frame("done", "Child answer"), "turn_id": "child"},
            frame("session.turn.failed", turn_id="child", error={"message": "Child failed", "code": "server_error"}),
        ]
        events = self.send(capabilities={"delegation": {"enabled": True}})
        rows = [e for e in events if e["type"] == "activity" and e.get("id")]
        self.assertEqual([(row["id"], row["label"], row["agent_id"]) for row in rows], [
            ("cmd", "Running command", "agent-[redacted]"),
            ("cmd", "Finished command", "agent-[redacted]"),
            ("next-cmd", "Finished command", "agent-[redacted]"),
        ])
        self.assertEqual(rows[1]["detail"], "echo [redacted]")
        self.assertEqual(sum(path.endswith("/turns/child") for _, path, _ in self.requests), 1)
        self.assertEqual(events[-1]["type"], "done")
        self.assertNotIn("tool call(s) failed", json.dumps(events))
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertNotIn("executor-secret", json.dumps(events))
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][0]
        self.assertEqual(archive["text"], "Answer")
        self.assertEqual(archive["outcome"], "done")
        self.assertEqual([(row["id"], row["agent_id"]) for row in archive["activities"] if row.get("id")],
                         [("cmd", "agent-[redacted]"), ("next-cmd", "agent-[redacted]")])

    def test_delegation_child_before_root_and_child_failure_never_set_outcome(self):
        self.turn_lookups = {"child": {"subagent_id": "a"}, "uncertain": None}
        self.stream_bodies = iter([EventBody([
            frame("session.turn.created", turn_id="child"),
            frame("session.turn.failed", turn_id="child", error={"message": "Child failed", "code": "server_error"}),
            subagent_frame("created", "a", turn_id="child"),
            frame("session.turn.created", turn_id="uncertain"),
            frame("session.turn.created", turn_id="root"),
            {**text_frame("done", "Child output"), "turn_id": "child"},
            frame("session.turn.failed", turn_id="child", error={"message": "Child failed", "code": "server_error"}),
            {**text_frame("done", "Root answer"), "turn_id": "root"},
            frame("session.turn.completed", turn_id="root", usage={"input_tokens": 2}),
            frame("session.idle", turn_id=None, session={**self.session, "status": "idle"}),
        ])])
        events = self.send(capabilities={"delegation": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["session"]["subagents"], {"open": 1, "known": True})
        turn = app.chat_history.get("chat-cap")["turns"][0]
        self.assertEqual(turn["text"], "Root answer")
        self.assertEqual(turn["outcome"], "done")
        self.assertEqual(turn["usage"], {"input_tokens": 2})
        self.assertNotIn("Child failed", json.dumps(turn))
        lookups = [path for method, path, _ in self.requests if "/turns/" in path]
        self.assertEqual(lookups, ["/v1/agents/sessions/sess_test/turns/child",
                                  "/v1/agents/sessions/sess_test/turns/uncertain",
                                  "/v1/agents/sessions/sess_test/turns/root"])

    def test_unknown_attribution_requires_run_membership_and_failed_lookups_are_cached(self):
        self.turn_lookups = {"known": None, "inconclusive-test-secret": "hang",
                             "no-owner": {"subagent_id": None}}
        self.script = [
            subagent_frame("active", "a", turn_id="known"),
            command_frame("added", "known", "known-cmd"),
            command_frame("done", "known", "known-cmd"),
            command_frame("done", "no-owner", "no-owner-cmd"),
            command_frame("added", "inconclusive-test-secret", "drop-cmd"),
            command_frame("done", "inconclusive-test-secret", "drop-cmd"),
            frame("session.turn.failed", turn_id="known"),
            frame("session.turn.completed", turn_id="no-owner"),
        ]
        with patch.object(app, "REMOTE_OPERATION_TIMEOUT_SECONDS", 0.01):
            events = self.send(capabilities={"delegation": {"enabled": True}})
        rows = [e for e in events if e["type"] == "activity" and e.get("id")]
        self.assertEqual([(row["id"], row["agent_id"]) for row in rows],
                         [("known-cmd", "unknown"), ("known-cmd", "unknown"),
                          ("no-owner-cmd", "unknown")])
        for turn_id in self.turn_lookups:
            self.assertEqual(sum(path.endswith(f"/turns/{turn_id}") for _, path, _ in self.requests), 1)
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][0]
        self.assertEqual(archive["text"], "Answer")
        self.assertEqual(archive["outcome"], "done")
        self.assertEqual([(row["id"], row["agent_id"]) for row in archive["activities"] if row.get("id")],
                         [("known-cmd", "unknown"), ("no-owner-cmd", "unknown")])
        logs = app.sessions["chat-cap"].logs.wait_after(0, timeout=0)
        log_text = "".join(record.text for record in logs.records)
        self.assertIn("Turn remains unattributed: inconclusive-[redacted]", log_text)
        self.assertNotIn("test-secret", log_text)

    def test_identical_idless_commands_from_different_agents_are_retained(self):
        self.turn_lookups = {"child-a": {"subagent_id": "a"}, "child-b": {"subagent_id": "b"}}
        self.script = [command_frame("done", turn_id, None) for turn_id in self.turn_lookups]
        events = self.send(capabilities={"delegation": {"enabled": True}})
        rows = [e for e in events if e.get("label") == "Finished command"]
        self.assertEqual([row["agent_id"] for row in rows], ["a", "b"])
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][0]
        self.assertEqual([row["agent_id"] for row in archive["activities"]
                          if row["label"] == "Finished command"], ["a", "b"])

    def test_interleaved_idless_commands_pair_with_their_agent_without_leaking_secrets(self):
        self.turn_lookups = {"child-test-secret": {"subagent_id": "a"}, "child-b": {"subagent_id": "b"}}
        self.script = [command_frame(kind, turn_id, None, "echo executor-secret")
                       for kind, turn_id in [("added", "child-test-secret"), ("added", "child-b"),
                                             ("done", "child-b"), ("done", "child-test-secret")]]
        events = self.send(capabilities={"delegation": {"enabled": True}})
        rows = [e for e in events if e.get("label") in {"Running command", "Finished command"}]
        self.assertEqual([row["agent_id"] for row in rows], ["a", "b", "b", "a"])
        self.assertEqual(rows[0]["id"], rows[3]["id"])
        self.assertEqual(rows[1]["id"], rows[2]["id"])
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertNotIn("executor-secret", json.dumps(events))
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][0]
        self.assertEqual([(row["agent_id"], row["label"]) for row in archive["activities"] if row.get("id")],
                         [("a", "Finished command"), ("b", "Finished command")])
        self.assertNotIn("executor-secret", json.dumps(archive))

    def test_attribution_cache_survives_reattach_and_prior_run_commands_stay_stale(self):
        self.turn_lookups = {"child": {"subagent_id": "a"}}
        self.stream_bodies = iter([
            EventBody([frame("session.turn.created"),
                       command_frame("added", "child", "cmd")], disconnect=True),
            EventBody([command_frame("done", "child", "cmd"),
                       text_frame("done", "First answer"), frame("session.turn.completed"),
                       frame("session.idle", session={**self.session, "status": "idle"})]),
        ])
        self.send(capabilities={"delegation": {"enabled": True}})
        self.assertEqual(sum(path.endswith("/turns/child") for _, path, _ in self.requests), 1)
        self.requests.clear()
        self.stream_bodies = iter([EventBody([
            command_frame("done", "child", "stale-before"),
            frame("session.turn.created", turn_id="root-next"),
            command_frame("done", "turn_test", "stale-root"),
            command_frame("done", "child", "stale-after"),
            subagent_frame("active", "a", turn_id="child"),
            frame("session.turn.failed", turn_id="child"),
            command_frame("done", "fresh-child", "fresh"),
            {**text_frame("done", "Next answer"), "turn_id": "root-next"},
            frame("session.turn.completed", turn_id="root-next", usage={"input_tokens": 1}),
            frame("session.idle", turn_id=None, session={**self.session, "status": "idle"}),
        ])])
        events = self.send()
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["session"]["subagents"], {"open": 0, "known": True})
        self.assertEqual([path.rsplit("/", 1)[-1] for _, path, _ in self.requests if "/turns/" in path],
                         ["root-next", "fresh-child"])
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][1]
        self.assertEqual(archive["text"], "Next answer")
        self.assertEqual([row["id"] for row in archive["activities"] if row.get("id")], ["fresh"])

    def test_plain_and_disabled_chats_do_no_attribution_lookups(self):
        self.terminal_usage = {"input_tokens": 1}
        self.script = [command_frame("done", "child", "child-cmd"),
                       command_frame("done", "turn_test", "root-cmd"),
                       frame("session.turn.failed", turn_id="child")]
        for index, fields in enumerate(({}, {"capabilities": {"delegation": {"enabled": False}}})):
            with self.subTest(fields=fields):
                events = self.send(chat_id=f"plain-attribution-{index}", **fields)
                self.assertEqual(events[-1]["type"], "done")
                self.assertFalse(any("/turns/" in path for _, path, _ in self.requests))
                rows = [e for e in events if e["type"] == "activity" and e.get("id")]
                self.assertEqual([(row["id"], row.get("agent_id")) for row in rows], [("root-cmd", None)])

    def test_delegation_root_lookup_is_bounded_and_stale_turns_cannot_latch(self):
        self.send(capabilities={"delegation": {"enabled": True}})
        self.requests.clear()
        self.turn_lookups = {"uncertain": "hang"}
        self.stream_bodies = iter([EventBody([
            {**text_frame("done", "Stale answer"), "turn_id": "turn_1"},
            frame("session.turn.created", turn_id="uncertain"),
            frame("session.turn.created", turn_id="root_next"),
            {**text_frame("done", "Next answer"), "turn_id": "root_next"},
            frame("session.turn.completed", turn_id="root_next"),
            frame("session.idle", turn_id=None, session={**self.session, "status": "idle"}),
        ])])
        with patch.object(app, "REMOTE_OPERATION_TIMEOUT_SECONDS", 0.01):
            events = self.send()
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(app.chat_history.get("chat-cap")["turns"][1]["text"], "Next answer")
        self.assertFalse(any(path.endswith("/turns/turn_1") for _, path, _ in self.requests))

    def test_root_qualification_retries_after_transient_failure_before_attribution_caching(self):
        self.turn_lookups = {"root": [None, {"subagent_id": None}],
                             "child": {"subagent_id": "a"}}
        self.stream_bodies = iter([EventBody([
            frame("session.turn.created", turn_id="child"),
            frame("session.turn.created", turn_id="root"),
            frame("session.turn.in_progress", turn_id="root"),
            command_frame("done", "child", "child-cmd"),
            {**text_frame("done", "Root answer"), "turn_id": "root"},
            frame("session.turn.completed", turn_id="root", usage={"input_tokens": 1}),
            frame("session.idle", turn_id=None, session={**self.session, "status": "idle"}),
        ])])
        events = self.send(capabilities={"delegation": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(sum(path.endswith("/turns/root") for _, path, _ in self.requests), 2)
        self.assertEqual(sum(path.endswith("/turns/child") for _, path, _ in self.requests), 1)
        archive = app.ChatHistory(self.history_path).get("chat-cap")["turns"][0]
        self.assertEqual(archive["text"], "Root answer")
        self.assertEqual(archive["outcome"], "done")
        self.assertEqual([row["agent_id"] for row in archive["activities"] if row.get("id")], ["a"])

    def test_delegation_reattach_keeps_count_unknown_for_rest_of_run(self):
        self.stream_bodies = iter([
            EventBody([frame("session.turn.created")], disconnect=True),
            EventBody([subagent_frame("created", "after-reconnect"),
                       text_frame("done", "Root answer"), frame("session.turn.completed"),
                       frame("session.idle", session={**self.session, "status": "idle"})]),
        ])
        events = self.send(capabilities={"delegation": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["session"]["subagents"], {"open": None, "known": False})
        self.assertEqual(sum(method == "POST" and path.endswith("/events")
                             for method, path, _ in self.requests), 1)

    def test_delegation_rows_redact_details_and_ids_and_survive_reload(self):
        labels = {
            "spawn_agent_call": "Spawn subagent", "send_input_call": "Send subagent input",
            "wait_for_agents_call": "Wait for subagents", "resume_agent_call": "Resume subagent",
            "close_agent_call": "Close subagent", "agent_message": "Agent message",
        }
        self.script = []
        for kind in labels:
            for populated in (True, False):
                item = {"id": f"{kind}-{populated}", "type": kind}
                if populated:
                    item.update(spawned_agent_id="agent-test-secret",
                                content=[{"type": "output_text", "text": "Review executor-secret"}],
                                model="gpt-5.6", reasoning_effort="medium")
                self.script.append(frame("session.turn.item.done", item=item))
        events = self.send(capabilities={"delegation": {"enabled": True}})
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertNotIn("executor-secret", json.dumps(events))
        rows = [e for e in events if e["type"] == "activity" and e.get("id")]
        self.assertEqual(len(rows), 12)
        for index, label in enumerate(labels.values()):
            rich, generic = rows[index * 2:index * 2 + 2]
            self.assertEqual(rich["label"], label)
            self.assertEqual(rich["agent_id"], "agent-[redacted]")
            self.assertEqual(rich["detail"], "Review [redacted] · gpt-5.6 · medium")
            self.assertEqual(generic["label"], label)
            self.assertIsNone(generic.get("agent_id"))
        archive = app.ChatHistory(self.history_path).get("chat-cap")
        archived_rows = [row for row in archive["turns"][0]["activities"] if row.get("id")]
        self.assertEqual(archived_rows[0]["agent_id"], "agent-[redacted]")
        self.assertEqual(archived_rows[0]["detail"], "Review [redacted] · gpt-5.6 · medium")

    def test_delegation_create_payload_default_limit_persistence_and_lock(self):
        for limit in (None, 1, 8):
            with self.subTest(limit=limit):
                delegation = {"enabled": True}
                if limit is not None:
                    delegation["max_agents"] = limit
                chat_id = f"delegation-{limit}"
                events = self.send(chat_id=chat_id, capabilities={"delegation": delegation})
                create = next(body for method, path, body in reversed(self.requests)
                              if method == "POST" and path.endswith("/sessions"))
                self.assertEqual(create["agent"]["multi_agent"],
                                 {"type": "enabled", "max_agents": limit or 3})
                self.assertIn("Delegation is available for independent subtasks.",
                              create["agent"]["instructions"])
                expected = {"enabled": True, "max_agents": limit or 3}
                self.assertEqual(events[-1]["session"]["capabilities"]["delegation"], expected)
                saved = json.loads(app.STATE_FILE.read_text())
                app.sessions.clear()
                app.chat_records = saved
                events = self.send(chat_id=chat_id, capabilities={"delegation": {"enabled": False}})
                self.assertEqual(events[-1]["session"]["capabilities"]["delegation"], expected)
                self.assertEqual(app.chat_history.get(chat_id)["capabilities"]["delegation"], expected)

    def test_delegation_rejects_invalid_limits(self):
        for limit in (0, 9, 1.5, True, "3"):
            with self.subTest(limit=limit):
                response = self.client.post("/api/chat", json={
                    "client_id": "client-test", "chat_id": "invalid-cap", "prompt": "Hello",
                    "capabilities": {"delegation": {"enabled": True, "max_agents": limit}},
                })
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.requests, [])

    def memory_action(self, text="Likes concise answers", *, call_id="save-one", turn_id=None, tags=None):
        action = {"type": "function_call", "name": "save_memory",
                  "turn_id": turn_id or f"turn_{self.turn_number + 1}", "call_id": call_id,
                  "arguments": {"text": text, "tags": tags or ["preferences"]}}
        return frame("session.requires_action", session={
            **self.session, "status": "requires_action", "required_actions": [action],
        })

    def tool_results(self):
        return [event for method, path, body in self.requests
                if method == "POST" and path.endswith("/events")
                for event in body["events"] if event["type"] == "session.input.tool_result"]

    def test_pending_memory_save_replay_uses_durable_ledger(self):
        action = self.memory_action()
        self.script = [action, action]

        def reload_after_first_result():
            self.on_tool_result = None
            self.assertEqual(len(self.tool_results()), 1)
            self.assertEqual(len(json.loads(self.memory_path.read_text())["entries"]), 1)
            app.memory_store = app.MemoryStore(self.memory_path)

        self.on_tool_result = reload_after_first_result
        self.send(capabilities={"memory": {"enabled": True}})
        results = self.tool_results()
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0]["turn_id"], "turn_1")
        self.assertEqual(results[0]["call_id"], "save-one")
        self.assertTrue(results[0]["success"])
        stored = json.loads(self.memory_path.read_text())
        self.assertEqual(len(stored["entries"]), 1)
        self.assertEqual(len(stored["ledger"]), 1)
        entry = stored["entries"][0]
        self.assertEqual(entry["text"], "Likes concise answers")
        self.assertEqual(entry["source_chat_id"], "chat-cap")
        self.assertEqual(entry["tags"], ["preferences"])
        self.assertTrue(entry["created_at"])
        self.assertNotEqual(entry["id"], "save-one")

    def test_delete_memory_then_replay_after_store_reload_does_not_resurrect(self):
        action = self.memory_action("Remember test-secret", tags=["executor-secret"])
        self.script = [action, action]

        def delete_saved():
            self.on_tool_result = None
            response = self.client.get("/api/memories")
            self.assertEqual(response.status_code, 200)
            entry = response.get_json()["entries"][0]
            self.assertEqual(entry["text"], "Remember [redacted]")
            self.assertEqual(entry["tags"], ["[redacted]"])
            response = self.client.delete(f"/api/memories/{entry['id']}")
            self.assertEqual(response.status_code, 200)
            app.memory_store = app.MemoryStore(self.memory_path)

        self.on_tool_result = delete_saved
        self.send(capabilities={"memory": {"enabled": True}})
        results = self.tool_results()
        self.assertEqual(len(results), 2)
        self.assertTrue(results[0]["success"])
        self.assertFalse(results[1]["success"])
        self.assertEqual(results[1]["error"], "Memory entry was deleted.")
        self.assertEqual(self.client.get("/api/memories").get_json(), {"entries": []})
        stored = self.memory_path.read_text()
        self.assertNotIn("test-secret", stored)
        self.assertNotIn("executor-secret", stored)
        self.assertEqual(len(json.loads(stored)["ledger"]), 1)

    def test_memory_endpoints_require_existing_auth(self):
        with patch.object(app.auth, "auth_enabled", return_value=True):
            for method, url in (("GET", "/api/memories"), ("DELETE", "/api/memories/missing")):
                self.assertEqual(self.client.open(url, method=method).status_code, 401)
        self.assertEqual(self.client.get("/api/memories").get_json(), {"entries": []})
        self.assertEqual(self.client.delete("/api/memories/missing").status_code, 404)

    def test_memory_recall_is_live_cross_chat_newest_first_and_bounded(self):
        self.send(chat_id="reader-chat", capabilities={"memory": {"enabled": True}})
        for index in range(22):
            self.script = [self.memory_action(f"Fact {index}", call_id=f"save-{index}", tags=["PREFERENCE"])]
            self.send(chat_id="writer-chat", capabilities={"memory": {"enabled": True}})
        self.script = [
            frame("session.turn.item.done", item={"type": "tool_search", "id": "search-one"}),
            frame("session.turn.item.added", item={
                "type": "function_call", "name": "recall_memory", "call_id": "recall-one",
                "arguments": {"query": "preference", "limit": 999},
            }),
            frame("session.turn.item.done", item={
                "type": "function_call", "name": "recall_memory", "call_id": "recall-one",
            }),
        ]
        self.send(chat_id="reader-chat")
        result = self.tool_results()[-1]
        self.assertEqual(result["call_id"], "recall-one")
        entries = json.loads(result["output"])["entries"]
        self.assertEqual(len(entries), 20)
        self.assertEqual([entry["text"] for entry in entries[:2]], ["Fact 21", "Fact 20"])
        self.assertTrue(all(entry["source_chat_id"] == "writer-chat" for entry in entries))
        activities = app.ChatHistory(self.history_path).get("reader-chat")["turns"][-1]["activities"]
        self.assertIn("Searched tools", [row["label"] for row in activities])
        self.assertIn("Called recall_memory", [row["label"] for row in activities])
        self.script[1]["item"]["arguments"] = {"query": "fAcT 21", "limit": 1}
        self.send(chat_id="reader-chat")
        self.assertEqual(len(json.loads(self.tool_results()[-1]["output"])["entries"]), 1)
        self.assertEqual(json.loads(self.tool_results()[-1]["output"])["entries"][0]["text"], "Fact 21")

    def test_memory_rejects_empty_oversized_and_invalid_arguments(self):
        for index, text in enumerate(("", "  ", "x" * 4001, None)):
            action = self.memory_action(text, call_id=f"invalid-{index}")
            self.script = [action, action]
            self.send(capabilities={"memory": {"enabled": True}})
            self.assertFalse(self.tool_results()[-1]["success"])
            self.assertEqual(self.tool_results()[-1], self.tool_results()[-2])
        self.assertEqual(self.client.get("/api/memories").get_json(), {"entries": []})

    def test_memory_replays_saved_result_after_tool_result_response_loss(self):
        self.tool_result_failures = 1
        action = self.memory_action()
        self.script = [action, action]
        events = self.send(capabilities={"memory": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(len(self.tool_results()), 2)
        self.assertEqual(self.tool_results()[0], self.tool_results()[1])
        self.assertEqual(len(self.client.get("/api/memories").get_json()["entries"]), 1)

    def test_memory_cancellation_during_result_delivery_skips_remaining_saves(self):
        first = self.memory_action("First memory")
        second = self.memory_action("Must not save", call_id="second-save")
        first["session"]["required_actions"].extend(second["session"]["required_actions"])
        self.script = [first]
        self.outcome = "cancelled"

        def cancel_after_first():
            self.on_tool_result = None
            response = self.client.post("/api/cancel", json={
                "client_id": "client-test", "chat_id": "chat-cap",
            })
            self.assertEqual(response.status_code, 200)

        self.on_tool_result = cancel_after_first
        events = self.send(capabilities={"memory": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "cancelled")
        entries = self.client.get("/api/memories").get_json()["entries"]
        self.assertEqual([entry["text"] for entry in entries], ["First memory"])
        self.assertEqual(len(self.tool_results()), 1)

    def test_memory_ignores_item_only_stale_and_disabled_save_calls(self):
        self.script = [self.memory_action()]
        self.send()
        self.assertEqual(self.tool_results(), [])
        self.script = [
            self.memory_action(turn_id="turn_1"),
            frame("session.turn.item.added", item={
                "type": "function_call", "name": "save_memory", "call_id": "item-only",
                "arguments": {"text": "Not pending", "tags": []},
            }),
        ]
        self.send(chat_id="enabled-chat", capabilities={"memory": {"enabled": True}})
        self.assertEqual(self.tool_results(), [])
        self.assertEqual(self.client.get("/api/memories").get_json(), {"entries": []})

    def test_two_chats_saving_concurrently_keep_valid_file_and_ledger(self):
        barrier = threading.Barrier(2)
        counter = iter(range(2))
        remote_sessions = {}

        async def handle(request):
            path = request.url.path
            if path.endswith("/sessions"):
                payload = json.loads(request.content)
                session_id = f"sess_{next(counter)}"
                remote_sessions[session_id] = {**self.session, "id": session_id, "agent": payload["agent"]}
                return httpx.Response(200, json=remote_sessions[session_id])
            session_id = path.split("/sessions/")[1].split("/")[0]
            session = remote_sessions[session_id]
            if path.endswith("/events"):
                if request.method == "POST":
                    return httpx.Response(202)
                turn_id = "turn_shared"
                action = {"type": "function_call", "name": "save_memory", "turn_id": turn_id,
                          "call_id": "same-call-id", "arguments": {"text": session_id, "tags": []}}
                return httpx.Response(200, stream=EventBody([
                    frame("session.turn.created", session_id=session_id, turn_id=turn_id),
                    frame("session.requires_action", session_id=session_id, turn_id=turn_id,
                          session={**session, "status": "requires_action", "required_actions": [action]}),
                    {**text_frame("done", "Saved"), "session_id": session_id, "turn_id": turn_id},
                    frame("session.turn.completed", session_id=session_id, turn_id=turn_id),
                    frame("session.idle", session_id=session_id, turn_id=turn_id,
                          session={**session, "status": "idle"}),
                ]), headers={"Content-Type": "text/event-stream"})
            return httpx.Response(200, json=session)

        def send(chat_id):
            barrier.wait(timeout=2)
            with app.app.test_client() as client:
                response = client.post("/api/chat", json={
                    "client_id": "client-test", "chat_id": chat_id, "prompt": "Remember",
                    "capabilities": {"memory": {"enabled": True}},
                })
                return response.get_data(as_text=True)

        with patch.object(app.httpx, "AsyncClient", side_effect=lambda **kwargs:
                self.real_http_client(transport=httpx.MockTransport(handle), **kwargs)):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(send, ("concurrent-one", "concurrent-two")))
        self.assertTrue(all(json.loads(response.split("data: ")[-1])["type"] == "done"
                            for response in responses))
        stored = json.loads(self.memory_path.read_text())
        self.assertEqual(len(stored["entries"]), 2)
        self.assertEqual(len(stored["ledger"]), 2)
        self.assertEqual({entry["source_chat_id"] for entry in stored["entries"]},
                         {"concurrent-one", "concurrent-two"})
        self.assertEqual(len(self.client.get("/api/memories").get_json()["entries"]), 2)

    def test_memory_tools_create_payload_lock_and_instructions(self):
        events = self.send(capabilities={"memory": {"enabled": True}})
        create = next(body for method, path, body in self.requests
                      if method == "POST" and path.endswith("/sessions"))
        tools = create["agent"]["tools"]
        self.assertEqual([tool for tool in tools if tool["type"] in {"web_search", "function"}
                          and not tool.get("defer_loading")], app.BASE_TOOLS)
        self.assertEqual({tool["server_label"] for tool in tools if tool["type"] == "mcp"},
                         {"openai_docs", "e2b_gateway"})
        self.assertIn({"type": "tool_search"}, tools)
        self.assertEqual({tool["name"] for tool in tools if tool.get("defer_loading")},
                         {"recall_memory", "save_memory"})
        instructions = create["agent"]["instructions"]
        self.assertIn("recall before assuming", instructions)
        self.assertIn("save only on explicit user request", instructions)
        self.assertIn("subagents do not have these tools", instructions)
        self.assertTrue(events[-1]["session"]["capabilities"]["memory"]["enabled"])
        app.sessions.clear()
        app.chat_records = json.loads(app.STATE_FILE.read_text())
        events = self.send(capabilities={"memory": {"enabled": False},
                   "delegation": {"enabled": False, "max_agents": 3}})
        self.assertTrue(events[-1]["session"]["capabilities"]["memory"]["enabled"])
        self.assertTrue(app.ChatHistory(self.history_path).get("chat-cap")["capabilities"]["memory"]["enabled"])

    def test_capabilities_create_payload_persistence_and_lock(self):
        enabled = {"reasoning_summary": {"enabled": True}, "memory": {"enabled": False},
                   "delegation": {"enabled": False, "max_agents": 3},
                   "mcp": {"servers": ["openai_docs"], "tool_search": False, "options": {}}}
        events = self.send(capabilities=enabled, reasoning_effort="low")
        creates = [body for method, path, body in self.requests
                   if method == "POST" and path.endswith("/sessions")]
        self.assertEqual(creates[0]["agent"]["reasoning"], {"effort": "low", "summary": "auto"})
        self.assertEqual(events[-1]["session"]["capabilities"], enabled)
        saved = json.loads(app.STATE_FILE.read_text())
        self.assertEqual(saved["chat-cap"]["capabilities"], enabled)
        app.sessions.clear()
        app.chat_records = saved
        events = self.send(capabilities={"reasoning_summary": {"enabled": False}})
        self.assertEqual(events[-1]["session"]["capabilities"], enabled)
        self.assertTrue(events[-1]["session"]["agent_locked"])
        self.assertEqual(app.chat_history.get("chat-cap")["capabilities"], enabled)
        self.assertEqual(len([1 for method, path, _ in self.requests
                              if method == "POST" and path.endswith("/sessions")]), 1)

    def test_plain_and_disabled_payloads_are_unchanged_and_archive_has_no_reasoning(self):
        for fields in ({}, {"capabilities": {"reasoning_summary": {"enabled": False},
                                              "delegation": {"enabled": False, "max_agents": 8}}}):
            with self.subTest(fields=fields):
                events = self.send(chat_id=f"plain-{len(self.requests)}", **fields)
                create = next(body for method, path, body in reversed(self.requests)
                              if method == "POST" and path.endswith("/sessions"))
                self.assertEqual(create["environment"],
                                 {"type": "self_hosted", "workspace_directory": app.WORKSPACE})
                self.assertEqual(create["agent"]["model"], app.MODEL)
                self.assertNotIn("reasoning", create["agent"])
                self.assertTrue(create["agent"]["instructions"].startswith(app.BASE_INSTRUCTIONS))
                self.assertIn({"type": "tool_search"}, create["agent"]["tools"])
                self.assertEqual({tool["server_label"] for tool in create["agent"]["tools"]
                                  if tool["type"] == "mcp"}, {"openai_docs", "e2b_gateway"})
                self.assertFalse(any(e["type"] == "reasoning" for e in events))
                archive = app.chat_history.get(events[-1]["session"]["chat_id"])
                self.assertIsNone(archive["turns"][0]["reasoning"])

    def test_reasoning_blocks_stream_and_done_repairs_without_duplicates(self):
        self.script = [
            reasoning_frame("part.added", part={"type": "summary_text", "text": ""}),
            reasoning_frame("text.added"),
            reasoning_frame("text.delta", delta="First block.\n"),
            reasoning_frame("text.done", text="First block.\n"),
            reasoning_frame("part.done", part={"type": "summary_text", "text": "First block.\n"}),
            reasoning_frame("text.added", index=1),
            reasoning_frame("text.delta", index=1, delta="Second"),
            reasoning_frame("text.done", index=1, text="Second block.\n"),
            reasoning_frame("part.done", index=1, part={"type": "summary_text", "text": "Second block.\n"}),
        ]
        events = self.send(capabilities={"reasoning_summary": {"enabled": True}})
        reasoning = [e for e in events if e["type"] == "reasoning"]
        self.assertIn({"type": "reasoning", "delta": "First block.\n"}, reasoning)
        repairs = [e for e in reasoning if "text" in e]
        self.assertEqual(repairs, [{"type": "reasoning", "text": "First block.\n\n\nSecond block.\n"}])
        self.assertEqual(app.chat_history.get("chat-cap")["turns"][0]["reasoning"],
                         "First block.\n\n\nSecond block.\n")
        reloaded = app.ChatHistory(self.history_path).get("chat-cap")
        self.assertEqual(reloaded["turns"][0]["reasoning"], "First block.\n\n\nSecond block.\n")

    def test_reasoning_redacts_split_secrets_independently_of_answer(self):
        self.script = [
            reasoning_frame("text.delta", delta="Plan test-"),
            text_frame("delta", "An"),
            reasoning_frame("text.delta", delta="secret then act.\n"),
            reasoning_frame("text.delta", delta="Use executor-"),
            reasoning_frame("text.delta", delta="secret safely.\n"),
            text_frame("delta", "swer"),
            reasoning_frame("text.done", text="Plan test-secret then act.\nUse executor-secret safely.\n"),
        ]
        events = self.send(capabilities={"reasoning_summary": {"enabled": True}})
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertNotIn("executor-secret", json.dumps(events))
        self.assertFalse(any(e["type"] == "reasoning" and "text" in e for e in events))
        self.assertEqual("".join(e["text"] for e in events if e["type"] == "delta"), "Answer")
        turn = app.chat_history.get("chat-cap")["turns"][0]
        self.assertEqual(turn["reasoning"], "Plan [redacted] then act.\nUse [redacted] safely.\n")
        self.assertEqual(turn["text"], "Answer")

    def test_mcp_credentials_are_redacted_from_split_and_completed_output(self):
        self.script = [
            text_frame("delta", "Key: mcp-private-"),
            text_frame("delta", "credential"),
            text_frame("done", "Key: mcp-private-credential. Done." + " extra" * 30),
            reasoning_frame("text.delta", delta="Use mcp-private-"),
            reasoning_frame("text.delta", delta="credential"),
            reasoning_frame("text.done", text="Use mcp-private-credential. Done."),
        ]
        events = self.send(capabilities={
            "reasoning_summary": {"enabled": True},
            "mcp": {"servers": ["exa"], "options": {"exa": {"apiKey": "mcp-private-credential"}}},
        })
        self.assertNotIn("mcp-private-credential", json.dumps(events))
        turn = app.chat_history.get("chat-cap")["turns"][0]
        self.assertTrue(any(str(event.get("text", "")).startswith("Key: [redacted]. Done.") for event in events))
        self.assertEqual(turn["text"], "Answer")
        self.assertEqual(turn["reasoning"], "Use [redacted]. Done.")

    def test_fork_copies_delegation_and_reasoning_settings_and_history(self):
        enabled = {"reasoning_summary": {"enabled": True}, "memory": {"enabled": True},
                   "delegation": {"enabled": True, "max_agents": 4},
                   "mcp": {"servers": ["openai_docs"], "tool_search": False, "options": {}}}
        self.script = [reasoning_frame("text.done", text="Private summary for display.")]
        self.send(capabilities=enabled)
        sandbox = SimpleNamespace(
            sandbox_id="sandbox_fake", files=SimpleNamespace(write=AsyncMock()),
            commands=SimpleNamespace(run=AsyncMock()),
            create_snapshot=AsyncMock(return_value=SimpleNamespace(snapshot_id="snapshot_fake")),
        )
        parent = app.sessions["chat-cap"]
        parent.sandbox = sandbox
        parent.sandbox_id = sandbox.sandbox_id

        async def launch(child, forked, *, executor_stopped=False):
            child.sandbox = forked
            child.sandbox_id = forked.sandbox_id

        with (
            patch.object(app.AsyncSandbox, "connect", new=AsyncMock(return_value=sandbox)),
            patch.object(app.AsyncSandbox, "create", new=AsyncMock(return_value=sandbox)),
            patch.object(app.AsyncSandbox, "delete_snapshot", new=AsyncMock()),
            patch.object(app, "launch_exec_server", new=launch),
            patch.object(app, "refine_wake", new=AsyncMock()),
        ):
            response = self.client.post("/api/fork", json={
                "client_id": "client-test", "chat_id": "chat-cap",
            })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()
        self.assertEqual(result["chat"]["capabilities"], enabled)
        self.assertEqual(result["archive"]["capabilities"], enabled)
        self.assertEqual(result["archive"]["turns"][0]["reasoning"], "Private summary for display.")
        create = next(body for method, path, body in reversed(self.requests)
                      if method == "POST" and path.endswith("/sessions"))
        self.assertEqual(create["agent"]["reasoning"], {"summary": "auto"})
        self.assertEqual(create["agent"]["multi_agent"], {"type": "enabled", "max_agents": 4})
        self.assertIn("Delegation is available for independent subtasks.", create["agent"]["instructions"])
        self.assertIn({"type": "tool_search"}, create["agent"]["tools"])
        self.assertIn("save only on explicit user request", create["agent"]["instructions"])
        self.assertIn("assistant: Answer", create["agent"]["instructions"])
        self.assertNotIn("Private summary", create["agent"]["instructions"])
        self.assertNotIn("Private summary", sandbox.files.write.call_args.args[1])
        self.script = []
        self.send(chat_id=result["chat"]["chat_id"])
        self.assertNotIn("Private summary", sandbox.files.write.call_args.args[1])

    def test_interleaved_reasoning_items_and_part_only_completion_stay_separate(self):
        self.script = [
            reasoning_frame("text.delta", item_id="one", delta="First"),
            reasoning_frame("text.delta", item_id="two", delta="Second"),
            reasoning_frame("text.delta", item_id="one", delta=" block."),
            reasoning_frame("text.done", item_id="one", text="First block."),
            reasoning_frame("part.done", item_id="two", part={"type": "summary_text", "text": "Second block."}),
            reasoning_frame("part.done", item_id="three", part={"type": "summary_text", "text": "Secret test-secret."}),
        ]
        events = self.send(capabilities={"reasoning_summary": {"enabled": True}})
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertEqual(app.chat_history.get("chat-cap")["turns"][0]["reasoning"],
                         "First block.\n\nSecond block.\n\nSecret [redacted].")

    def test_cancelled_reasoning_is_retained_and_late_turn_summaries_are_ignored(self):
        self.script = [reasoning_frame("text.delta", delta="Partial summary")]
        self.outcome = "cancelled"
        events = self.send(capabilities={"reasoning_summary": {"enabled": True}})
        self.assertEqual(events[-1]["type"], "cancelled")
        self.assertEqual(app.chat_history.get("chat-cap")["turns"][0]["reasoning"], "Partial summary")
        self.script = [reasoning_frame("text.done", turn_id="turn_1", text="Stale reasoning")]
        self.outcome = "completed"
        events = self.send()
        self.assertFalse(any(e["type"] == "reasoning" for e in events))
        self.assertIsNone(app.chat_history.get("chat-cap")["turns"][1]["reasoning"])

    def test_mcp_picker_payload_persistence_and_lock(self):
        picked = {"servers": ["time", "duckduckgo"], "tool_search": True}
        events = self.send(capabilities={"mcp": picked})
        create = next(body for method, path, body in self.requests
                      if method == "POST" and path.endswith("/sessions"))
        tools = create["agent"]["tools"]
        # Registry order, not the order the picker sent them in.
        self.assertEqual([tool["server_label"] for tool in tools if tool["type"] == "mcp"],
                         ["duckduckgo", "time"])
        self.assertEqual(tools[0], {
            "type": "mcp", "server_label": "duckduckgo",
            "transport": {"type": "stdio", "command": mcp_servers.STDIO_LAUNCHER,
                          "args": ["duckduckgo-mcp-server"], "cwd": app.WORKSPACE},
            "connection_origin": "environment", "required": False,
        })
        self.assertEqual(tools[2:], [app.BASE_TOOLS[0],
                                   {**app.BASE_TOOLS[1], "defer_loading": True},
                                   {"type": "tool_search"}])
        instructions = create["agent"]["instructions"]
        self.assertIn("DuckDuckGo (duckduckgo)", instructions)
        self.assertIn("Time (time)", instructions)
        self.assertNotIn("openai_docs", instructions)
        self.assertIn("search for a tool before", instructions)
        # Selection rides the snapshot, the transcript and the restart record.
        self.assertEqual(events[-1]["session"]["capabilities"]["mcp"],
                         {"servers": ["duckduckgo", "time"], "tool_search": True, "options": {}})
        saved = json.loads(app.STATE_FILE.read_text())
        self.assertEqual(saved["chat-cap"]["capabilities"]["mcp"]["servers"],
                         ["duckduckgo", "time"])
        self.assertEqual(app.chat_history.get("chat-cap")["capabilities"]["mcp"]["servers"],
                         ["duckduckgo", "time"])
        # Tools bind at session creation: a later pick cannot retarget them.
        app.sessions.clear()
        app.chat_records = saved
        events = self.send(capabilities={"mcp": {"servers": ["wikipedia"]}})
        self.assertEqual(events[-1]["session"]["capabilities"]["mcp"]["servers"],
                         ["duckduckgo", "time"])
        self.assertEqual(len([1 for method, path, _ in self.requests
                              if method == "POST" and path.endswith("/sessions")]), 1)

    def test_saved_mcp_credentials_resolve_on_first_and_later_turns(self):
        with patch.object(app, "mcp_credentials", {}):
            response = self.client.post("/api/mcp/credentials", json={
                "server": "exa", "options": {"apiKey": "exa-saved-key"}})
            self.assertEqual(response.status_code, 200)
            first = self.send(capabilities={"mcp": {"servers": ["exa"]}})
            self.assertEqual(first[-1]["session"]["capabilities"]["mcp"]["options"],
                             {"exa": {"apiKey": "•"}})
            # A subsequent request carries no credential and may have different
            # new-chat defaults. The existing chat keeps its selection.
            second = self.send(capabilities={"mcp": {"servers": ["openai_docs"]}})
            self.assertEqual(second[-1]["session"]["capabilities"]["mcp"]["servers"], ["exa"])
            self.assertEqual(app.sessions["chat-cap"].capabilities.mcp.options,
                             {"exa": {"apiKey": "exa-saved-key"}})
            self.assertNotIn("exa-saved-key", app.STATE_FILE.read_text())

    def test_mcp_tool_search_is_declared_once_alongside_memory(self):
        self.send(capabilities={"mcp": {"servers": [], "tool_search": True},
                                "memory": {"enabled": True}})
        create = next(body for method, path, body in self.requests
                      if method == "POST" and path.endswith("/sessions"))
        tools = create["agent"]["tools"]
        self.assertEqual([tool["type"] for tool in tools].count("tool_search"), 1)
        self.assertEqual([tool for tool in tools if tool["type"] == "mcp"], [])
        self.assertEqual({tool["name"] for tool in tools if tool.get("defer_loading")},
                         {"recall_memory", "save_memory"})
        self.assertIn("No MCP servers are connected", create["agent"]["instructions"])
        self.assertIn("save only on explicit user request", create["agent"]["instructions"])

    def test_unknown_mcp_server_is_refused_before_a_session_exists(self):
        response = self.client.post("/api/chat", json={
            "client_id": "client-test", "chat_id": "chat-cap", "prompt": "Hello",
            "capabilities": {"mcp": {"servers": ["duckduckgo", "nope"]}},
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Unknown MCP servers: nope.")
        self.assertEqual(self.requests, [])
        self.assertEqual(app.sessions, {})

    def test_mcp_catalog_lists_every_selectable_server(self):
        catalog = self.client.get("/api/mcp/servers").get_json()
        self.assertEqual(catalog["default"], ["hackernews", "context7", "deepwiki", "openai_docs"])
        labels = [server["label"] for server in catalog["servers"]]
        # Hand-listed servers first, then E2B's whole catalog off the SDK.
        self.assertEqual(labels[:4], ["openai_docs", "duckduckgo", "wikipedia", "time"])
        self.assertGreater(len(labels), 200)
        self.assertEqual(len(labels), len(set(labels)), "labels must be unique")
        for label in ("fetch", "hackernews", "markdownify", "sequentialthinking", "exa"):
            self.assertIn(label, labels)
        docs, duck = catalog["servers"][:2]
        context7 = next(server for server in catalog["servers"] if server["label"] == "context7")
        self.assertEqual((docs["connection_origin"], docs["runs_in_sandbox"], docs["launch"]),
                         ("service", False, None))
        # Context7 is a remote entry routed through E2B's gateway.
        self.assertEqual((context7["connection_origin"], context7["server_url"]),
                         ("gateway", None))
        self.assertNotIn("authorization", json.dumps(context7))
        self.assertEqual((duck["connection_origin"], duck["runs_in_sandbox"]),
                         ("environment", True))
        self.assertIn("duckduckgo-mcp-server", duck["launch"])
        # E2B's hosted catalog: cached in the image, started by mcp-gateway.
        hosted = next(server for server in catalog["servers"]
                      if server["label"] == "markdownify")
        self.assertEqual((hosted["connection_origin"], hosted["runs_in_sandbox"],
                          hosted["server_url"]), ("gateway", True, None))
        self.assertIn("mcp-gateway --config", hosted["launch"])
        self.assertTrue(hosted["prepulled"])
        self.assertTrue(all(server["name"] and server["description"]
                            for server in catalog["servers"]))
        # Option metadata drives the key inputs and the "free" filter.
        exa = next(server for server in catalog["servers"] if server["label"] == "exa")
        self.assertEqual((exa["needs_config"], exa["prepulled"]), (True, False))
        self.assertEqual(exa["options"], [{"key": "apiKey", "required": True,
                                           "description": mock.ANY, "secret": True}])
        self.assertFalse(next(server for server in catalog["servers"]
                              if server["label"] == "youtubeTranscript")["needs_config"])
        self.assertNotIn("authorization", json.dumps(catalog))

    def test_mcp_options_are_validated_and_masked_everywhere_but_the_gateway_config(self):
        post = lambda capabilities: self.client.post("/api/chat", json={
            "client_id": "client-test", "chat_id": "chat-cap", "prompt": "Hello",
            "capabilities": capabilities})
        response = post({"mcp": {"servers": ["exa"], "options": {"exa": {"apiKey": "k", "nope": "x"}}}})
        self.assertEqual((response.status_code, response.get_json()["error"]),
                         (400, "Unknown MCP options: exa.nope."))
        self.assertEqual(self.requests, [])
        # No key on file means exa is not configured, so a new chat skips it
        # instead of refusing to start. The picker never saves such a pick;
        # a selection saved before a restart can still name one.
        events = self.send(capabilities={"mcp": {"servers": ["exa", "fetch"]}})
        self.assertEqual(events[-1]["session"]["capabilities"]["mcp"],
                         {"servers": ["fetch"], "tool_search": True, "options": {}})
        create = next(body for method, path, body in self.requests
                      if method == "POST" and path.endswith("/sessions"))
        self.assertNotIn("exa", create["agent"]["instructions"])
        self.assertIn("Fetch (fetch)", create["agent"]["instructions"])
        # A resumed chat already bound its tools to exa: that one does refuse.
        app.sessions.clear()
        saved = json.loads(app.STATE_FILE.read_text())
        saved["chat-cap"]["capabilities"]["mcp"] = {"servers": ["exa"], "options": {"exa": {"apiKey": "•"}}}
        app.chat_records = saved
        response = post({"mcp": {"servers": ["exa"]}})
        self.assertEqual((response.status_code, response.get_json()["error"]),
                         (400, "MCP servers need config: exa.apiKey. "
                               "Save the credentials again, or fork the chat without them."))
        capabilities = app.Capabilities.model_validate(
            {"mcp": {"servers": ["exa", "fetch"], "options": {"exa": {"apiKey": "exa-secret"}}}})
        self.assertEqual(mcp_servers.gateway_config(capabilities.mcp.servers, capabilities.mcp.options),
                         '{"exa": {"apiKey": "exa-secret"}, "fetch": {}}')
        # Public and persisted dumps see the mask. Explicit internal dumps
        # can still access values for gateway construction.
        self.assertEqual(capabilities.model_dump()["mcp"]["options"], {"exa": {"apiKey": "•"}})
        self.assertEqual(capabilities.model_dump(context={"secrets": True})["mcp"]["options"],
                         {"exa": {"apiKey": "exa-secret"}})
        self.assertEqual(app.Capabilities.model_validate(capabilities.model_dump()).mcp.options, {})
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret",
                               capabilities=capabilities)
        self.assertEqual(app.redact_for_demo(demo, "sent exa-secret upstream"), "sent [redacted] upstream")


class McpSelectionTest(unittest.TestCase):
    def test_pinned_servers_all_route_through_the_gateway(self):
        labels = ["hackernews", "context7", "deepwiki"]
        for label, name in zip(labels, ["Hacker News", "Context7", "DeepWiki"]):
            spec = mcp_servers.MCP_SERVERS_BY_LABEL[label]
            self.assertEqual(spec.name, name)
            self.assertTrue(spec.on_gateway)
            self.assertIsNone(spec.server_url)
        self.assertEqual(json.loads(mcp_servers.gateway_config(labels)),
                         {"context7": {}, "deepwiki": {}, "hackernews": {}})
        tools = mcp_servers.mcp_tools(labels, "/workspace", "test-token")
        self.assertEqual([tool["server_label"] for tool in tools], ["e2b_gateway"])

    def test_selection_is_deduplicated_and_survives_a_retired_server(self):
        capabilities = app.Capabilities.model_validate(
            {"mcp": {"servers": ["time", "gone_from_registry", "time", "openai_docs"]}}
        )
        self.assertEqual(capabilities.mcp.servers, ["openai_docs", "time"])
        self.assertTrue(capabilities.mcp.tool_search)

    def test_defaults_connect_all_four_mcps_and_require_real_calls_for_tests(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret")
        self.assertEqual(demo.capabilities.mcp.servers,
                         ["hackernews", "context7", "deepwiki", "openai_docs"])
        self.assertTrue(demo.capabilities.mcp.tool_search)
        agent = app.build_agent_param(demo)
        self.assertEqual({tool["server_label"] for tool in agent["tools"] if tool["type"] == "mcp"},
                         {"openai_docs", "e2b_gateway"})
        self.assertIn({"type": "tool_search"}, agent["tools"])
        self.assertTrue(any(tool.get("defer_loading") for tool in agent["tools"]),
                        "Tool search must also work in chats without memory tools")
        for name in ("Hacker News", "Context7", "DeepWiki", "OpenAI Docs"):
            self.assertIn(name, agent["instructions"])
        for policy in ("briefly acknowledge", "make actual", "substantive",
                       "Do not substitute", "Never claim"):
            self.assertIn(policy, agent["instructions"])

    def test_read_session_capabilities_reflects_the_attached_servers(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret")
        session = SimpleNamespace(info=SimpleNamespace(agent={"tools": [
            {"type": "mcp", "server_label": "time"},
            {"type": "mcp", "server_label": "wikipedia"},
            {"type": "mcp", "server_label": "gone_from_registry"},
            {"type": "tool_search"},
        ]}))
        app.read_session_capabilities(demo, session)
        self.assertEqual(demo.capabilities.mcp.servers, ["wikipedia", "time"])
        self.assertTrue(demo.capabilities.mcp.tool_search)

    def test_gateway_servers_share_one_authenticated_tool(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test",
                               api_key="secret", executor_api_key="executor-secret")
        demo.capabilities.mcp.servers = ["markdownify", "time", "hackernews"]
        tools = [tool for tool in app.build_agent_param(demo)["tools"]
                 if tool["type"] == "mcp"]
        # The executor uses stdio: its HTTP relay fails during the gateway's
        # SSE handshake. Credentials travel through the executor environment.
        self.assertEqual([tool["server_label"] for tool in tools],
                         ["time", "e2b_gateway"])
        self.assertEqual(tools[1], {
            "type": "mcp", "server_label": "e2b_gateway",
            "transport": {
                "type": "stdio", "command": mcp_servers.STDIO_LAUNCHER,
                "args": ["--with", "mcp==1.26.0", "mcp-proxy==0.11.0",
                         "--transport", "streamablehttp", mcp_servers.GATEWAY_URL],
                "cwd": app.WORKSPACE, "env_vars": ["API_ACCESS_TOKEN"],
            },
            "connection_origin": "environment", "required": True,
        })
        self.assertNotIn(demo.mcp_token, json.dumps(app.build_agent_param(demo)))
        self.assertEqual(mcp_servers.gateway_config(demo.capabilities.mcp.servers),
                         '{"hackernews": {}, "markdownify": {}}')
        # Derived per chat and per credential, and never logged in the clear.
        fork = app.DemoSession(chat_id="chat-fork", client_id="client-test",
                               api_key="secret", executor_api_key="executor-secret")
        self.assertNotEqual(fork.mcp_token, demo.mcp_token)
        self.assertEqual(app.redact_for_demo(demo, f"token {demo.mcp_token}"),
                         "token [redacted]")

    def test_gateway_bridge_inherits_the_token_on_executor_launch(self):
        async def check():
            for servers in (["hackernews"], ["openai_docs"]):
                demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test",
                                       api_key="secret", environment_id="env-test")
                demo.capabilities.mcp.servers = servers
                calls = []

                async def run(command, **kwargs):
                    calls.append((command, kwargs))
                    if command.startswith("codex exec-server"):
                        kwargs["on_stderr"](app.RENDEZVOUS_MARKER)
                    return SimpleNamespace(exit_code=None)

                sandbox = SimpleNamespace(commands=SimpleNamespace(run=run), sandbox_id="sandbox-test")
                with patch.object(app, "start_mcp_gateway", new=AsyncMock()):
                    await app.launch_exec_server(demo, sandbox)
                executor_env = calls[-1][1]["envs"]
                if servers == ["hackernews"]:
                    self.assertEqual(executor_env["API_ACCESS_TOKEN"], demo.mcp_token)
                else:
                    self.assertNotIn("API_ACCESS_TOKEN", executor_env)
                self.assertNotIn(demo.mcp_token, demo.logs.recent_text(
                    source="executor", stream="stderr", limit=2000))

        asyncio.run(check())

    def test_gateway_start_is_skipped_restarted_and_fails_loudly(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret")
        runs = []

        async def run(command, **kwargs):
            runs.append((command, kwargs))
            # The SDK raises on a nonzero exit instead of returning it.
            if self.exit_code:
                raise CommandExitException(stdout="", exit_code=self.exit_code, error=None,
                                           stderr="/bin/bash: line 1: mcp-gateway: command not found")
            return SimpleNamespace(exit_code=0)

        self.exit_code = 0
        sandbox = SimpleNamespace(commands=SimpleNamespace(run=run))
        # Nothing picked: no gateway, but a resumed one must not linger.
        demo.capabilities.mcp.servers = []
        asyncio.run(app.start_mcp_gateway(demo, sandbox))
        self.assertEqual(runs, [("pkill -x mcp-gateway || true", {})])
        runs.clear()
        demo.capabilities.mcp.servers = ["fetch", "openai_docs"]
        asyncio.run(app.start_mcp_gateway(demo, sandbox))
        command, kwargs = runs[0]
        self.assertIn("pkill -x mcp-gateway;", command)
        self.assertIn("mcp-gateway --config", command)
        self.assertIn('"fetch"', command)
        self.assertNotIn("openai_docs", command)
        self.assertEqual(kwargs["envs"], {"GATEWAY_ACCESS_TOKEN": demo.mcp_token})
        self.exit_code = 127
        with self.assertRaises(RuntimeError) as failure:
            asyncio.run(app.start_mcp_gateway(demo, sandbox))
        self.assertIn("fetch", str(failure.exception))
        # The sandbox's own words ride along: the usual cause is an image
        # built before the mcp-gateway base, and this is how the user learns it.
        self.assertIn("mcp-gateway: command not found", str(failure.exception))
        self.assertIn("rebuild the executor template", str(failure.exception))

    def test_resume_keeps_gateway_picks_behind_the_shared_label(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret")
        demo.capabilities.mcp.servers = ["markdownify", "time", "fetch"]
        session = SimpleNamespace(info=SimpleNamespace(agent={"tools": [
            {"type": "mcp", "server_label": "time"},
            {"type": "mcp", "server_label": "e2b_gateway"},
        ]}))
        app.read_session_capabilities(demo, session)
        # Upstream cannot name the gateway's servers, so the chat's own picks
        # stand — dropping them would silently shrink the selection on resume.
        self.assertEqual(demo.capabilities.mcp.servers, ["time", "fetch", "markdownify"])

    def test_memory_tool_search_does_not_forge_a_picker_toggle(self):
        demo = app.DemoSession(chat_id="chat-mcp", client_id="client-test", api_key="secret")
        demo.capabilities.mcp.tool_search = False
        session = SimpleNamespace(info=SimpleNamespace(agent={"tools": [
            {"type": "tool_search"},
            {"type": "function", "name": "save_memory", "defer_loading": True},
        ]}))
        app.read_session_capabilities(demo, session)
        self.assertTrue(demo.capabilities.memory.enabled)
        self.assertEqual(demo.capabilities.mcp.servers, [])
        self.assertFalse(demo.capabilities.mcp.tool_search)


class SteeringTest(unittest.IsolatedAsyncioTestCase):
    async def test_no_active_root_refuses_without_posting(self):
        demo = app.DemoSession(chat_id="chat-steer", client_id="client-test", api_key="secret")
        with patch.object(app, "get_demo", return_value=demo), patch.object(app, "_loop", asyncio.get_running_loop()):
            for locked in (False, True):
                if locked:
                    demo.turn_lock.acquire()
                response = await asyncio.to_thread(lambda: app.app.test_client().post(
                    "/api/steer", json={"chat_id": demo.chat_id, "client_id": "client-test", "text": "focus secret", "submission_id": "submit-1"},
                ))
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json["code"], "no_active_turn")
                self.assertEqual(response.json["preview_text"], "focus [redacted]")
            demo.turn_lock.release()

    async def scenario(self, *, texts=("focus",), retained=(), later=(), post_status=202, cancel=False, concurrent=False, later_live=False, root_subagent=None, restart=False, cancel_reconciliation=False, paginated=False, usage_by_turn=None, summaries=False, capabilities=None, early_root=False, save_on_adoption=False, lifecycle_rejections=0, cancel_delay=0, lifecycle_delay=0, cancel_failure=False, retry_conflicts=(), leading_text=""):
        import tempfile
        from pathlib import Path
        from chat_history import ChatHistory

        self.posts = []
        self.post_keys = []
        self.streams = 0
        release = asyncio.Event()
        cancelled = asyncio.Event()
        after_failed_cancel = asyncio.Event()
        reconciling = asyncio.Event()
        demo = app.DemoSession(chat_id="chat-steer", client_id="client-test", api_key="test-secret", session_id="sess_test",
                               capabilities=app.Capabilities.model_validate(capabilities or {}))

        class LiveBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield f'data: {json.dumps(frame("session.turn.created"))}\n\n'.encode()
                if leading_text:
                    yield f'data: {json.dumps(text_frame("delta", leading_text))}\n\n'.encode()
                await release.wait()
                if summaries:
                    yield f'data: {json.dumps(reasoning_frame("text.delta", delta="Root summary test-secret"))}\n\n'.encode()
                yield f'data: {json.dumps(text_frame("done", "Still working"))}\n\n'.encode()
                if early_root:
                    for item in [frame("session.turn.created", turn_id="turn_late"),
                                 command_frame("done", "turn_late", "early-command")]:
                        yield f'data: {json.dumps(item)}\n\n'.encode()
                if cancel:
                    await cancelled.wait()
                    await asyncio.sleep(cancel_delay)
                    if cancel_failure:
                        await after_failed_cancel.wait()
                yield f'data: {json.dumps(frame("session.turn.cancelled" if cancel and not cancel_failure else "session.turn.completed"))}\n\n'.encode()
                yield f'data: {json.dumps(frame("session.idle", session={**SESSION, "status": "idle"}))}\n\n'.encode()

        class AdoptedBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                if summaries:
                    yield f'data: {json.dumps(reasoning_frame("text.delta", turn_id="turn_late", delta="Adopted summary test-secret"))}\n\n'.encode()
                # These are stale or delegated events, never the adopted output.
                for item in [text_frame("done", "stale root output"), frame("session.turn.completed", turn_id="delegated")]:
                    yield f'data: {json.dumps(item)}\n\n'.encode()
                yield f'data: {json.dumps({**text_frame("delta", "live adopted suffix"), "turn_id": "turn_late", "item_id": "turn_late-answer"})}\n\n'.encode()
                if save_on_adoption:
                    yield f'data: {json.dumps(frame("session.requires_action", turn_id="turn_late", session={
                        **SESSION, "status": "requires_action", "required_actions": [{
                            "type": "function_call", "name": "save_memory", "turn_id": "turn_late",
                            "call_id": "adopted-save", "arguments": {"text": "Remember test-secret", "tags": []},
                        }],
                    }))}\n\n'.encode()
                if cancel_reconciliation:
                    await cancelled.wait()
                yield f'data: {json.dumps(frame("session.turn.cancelled" if cancel_reconciliation else "session.turn.completed", turn_id="turn_late"))}\n\n'.encode()

        def turn(turn_id="turn_test", subagent_id=None):
            return {"id": turn_id, "object": "session.turn", "session_id": "sess_test", "agent_id": "agent_test",
                    "subagent_id": subagent_id, "status": "completed", "created_at": int(app.time.time()) + 1,
                    "started_at": 1, "completed_at": 2, "error": None, "usage": None}

        async def handle(request):
            path = request.url.path
            if path.endswith("/events"):
                if request.method == "POST":
                    body = json.loads(request.content)["events"][0]
                    self.posts.append(body)
                    self.post_keys.append(request.headers.get("Idempotency-Key"))
                    if body["type"] == "session.input.cancel":
                        cancelled.set()
                        if cancel_failure:
                            return httpx.Response(409, json={"error": {"code": "conflict_error", "message": "cancel rejected"}})
                    elif len(self.posts) > 1:
                        if len(self.posts) - 1 <= len(retry_conflicts):
                            return httpx.Response(409, json={"error": {
                                "code": "conflict_error", "message": retry_conflicts[len(self.posts) - 2],
                            }})
                        if len(self.posts) - 1 <= lifecycle_rejections:
                            await asyncio.sleep(lifecycle_delay)
                            return httpx.Response(409, json={"error": {
                                "code": "conflict_error",
                                "message": "managed agent turn is awaiting lifecycle finalization; retry with a new Idempotency-Key after it completes",
                            }})
                        if post_status == "dropped":
                            raise httpx.ReadError("dropped 202")
                        if post_status == "hung":
                            await asyncio.Future()
                        if post_status != 202:
                            return httpx.Response(post_status, json={"error": {"code": "active_turn_not_steerable", "message": "no steering test-secret"}})
                    return httpx.Response(202)
                self.streams += 1
                return httpx.Response(200, stream=LiveBody() if self.streams == 1 else AdoptedBody() if later_live else EventBody([], hang=True), headers={"Content-Type": "text/event-stream"})
            if "/turns/" in path:
                tid = path.rsplit("/", 1)[1]
                info = turn(tid, root_subagent if tid == "turn_test" else None)
                info["usage"] = (usage_by_turn or {}).get(tid)
                if later_live and tid != "turn_test":
                    info["status"] = "in_progress"
                return httpx.Response(200, json=info)
            if path.endswith("/turns"):
                rows = [turn(tid, child) for tid, child, _ in later]
                offset = next((i + 1 for i, row in enumerate(rows) if row["id"] == request.url.params.get("after")), 0)
                data = rows[offset:offset + 1] if paginated else rows
                return httpx.Response(200, json={"object": "list", "first_id": data[0]["id"] if data else None,
                    "last_id": data[-1]["id"] if data else None, "data": data, "has_more": paginated and offset + 1 < len(rows)})
            if path.endswith("/items"):
                reconciling.set()
                if cancel_reconciliation and not demo.cancel_requested.is_set() and not cancelled.is_set():
                    await asyncio.sleep(0.015)
                    return httpx.Response(200, json={"data": [], "has_more": False, "before": None, "after": None})
                items = [{"id": "initial", "turn_id": "turn_test", "type": "message", "role": "user", "content": "initial"}]
                items += [{"id": f"input-{i}", "turn_id": "turn_test", "type": "message", "role": "user", "content": text} for i, text in enumerate(retained)]
                for tid, _, text in later if len(self.posts) - 1 > max(lifecycle_rejections, len(retry_conflicts)) else ():
                    items += [{"id": f"{tid}-user", "turn_id": tid, "type": "message", "role": "user", "content": text},
                              {"id": f"{tid}-answer", "turn_id": tid, "type": "message", "role": "assistant", "status": "completed", "content": "Adopted answer test-secret"}]
                if request.url.params.get("order") == "desc":
                    items.reverse()
                offset = next((i + 1 for i, row in enumerate(items) if row["id"] == request.url.params.get("after")), 0)
                data = items[offset:offset + 1] if paginated else items
                return httpx.Response(200, json={"data": data, "has_more": paginated and offset + 1 < len(items),
                    "before": None, "after": data[-1]["id"] if data else None})
            return httpx.Response(200, json=SESSION)

        real_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            history = ChatHistory(Path(directory))
            with (
                patch.object(app.httpx, "AsyncClient", side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw)),
                patch.object(app, "ensure_executor", new=AsyncMock()),
                patch.object(app, "ensure_executor_running"),
                patch.object(app, "save_chat_record"),
                patch.object(app, "get_or_create_demo", return_value=demo),
                patch.object(app, "get_demo", return_value=demo),
                patch.object(app, "chat_history", history),
                patch.object(app, "memory_store", app.MemoryStore(Path(directory) / "memories" / "memory.json")),
                patch.object(app, "_loop", asyncio.get_running_loop()),
                patch.object(app, "STEER_RECONCILE_SECONDS", 0.08, create=True),
                patch.object(app, "REMOTE_OPERATION_TIMEOUT_SECONDS", 0.06),
                patch.object(app, "STEER_RETRY_SECONDS", 0.3, create=True),
                patch.object(app, "STEER_RETRY_INTERVAL_SECONDS", 0.02, create=True),
            ):
                def post(path, body):
                    return app.app.test_client().post(path, json={"chat_id": demo.chat_id, "client_id": "client-test", **body}, buffered=True)
                run = asyncio.create_task(asyncio.to_thread(post, "/api/chat", {"prompt": "initial"}))
                async with asyncio.timeout(2):
                    while demo.active_turn_id is None:
                        await asyncio.sleep(0.001)
                    if leading_text:
                        while not history.get(demo.chat_id)["turns"][0]["text"]:
                            await asyncio.sleep(0.001)
                    self.responses = []
                    for i, text in enumerate(texts):
                        self.responses.append(await asyncio.to_thread(post, "/api/steer", {"text": text, "submission_id": f"submit-{i}"}))
                    if concurrent:
                        self.concurrent = await asyncio.gather(*[asyncio.to_thread(post, "/api/steer", {"text": "raced", "submission_id": "raced-id"}) for _ in range(4)])
                    self.duplicate = await asyncio.to_thread(post, "/api/steer", {"text": texts[0], "submission_id": "submit-0"})
                    await asyncio.sleep(0.01)
                    self.during = history.get(demo.chat_id)
                    if restart:
                        self.restarted_during = ChatHistory(Path(directory)).get(demo.chat_id)
                    if cancel:
                        response = await asyncio.to_thread(post, "/api/cancel", {})
                        self.assertEqual(response.status_code, 200)
                    release.set()
                    if cancel_failure:
                        await cancelled.wait()
                        while demo.cancel_requested.is_set():
                            await asyncio.sleep(0.001)
                        await asyncio.sleep(0.04)
                        self.after_failed_cancel = await asyncio.to_thread(post, "/api/steer", {"text": "fresh", "submission_id": "fresh-id"})
                        after_failed_cancel.set()
                    if cancel_reconciliation:
                        await reconciling.wait()
                        response = await asyncio.to_thread(post, "/api/cancel", {})
                        self.assertEqual(response.status_code, 200)
                    response = await run
                    raw = await asyncio.to_thread(response.get_data, as_text=True)
                self.events = [json.loads(line[6:]) for line in raw.splitlines() if line.startswith("data: ")]
                self.archive = history.get(demo.chat_id)
                self.memories = app.memory_store.list()
                self.reloaded = ChatHistory(Path(directory)).get(demo.chat_id)
                self.fork = history.prepare_fork(demo.chat_id, "fork-chat", parent_chat_id=demo.chat_id, sandbox_id=None, session_id=None, sibling=False)
                self.transcript = await app.render_parent_transcript(None, demo)
                self.repeat_after = await asyncio.to_thread(post, "/api/steer", {"text": texts[0], "submission_id": "submit-0"})
                self.assertFalse(demo.turn_lock.locked())

    async def test_posted_once_and_confirmed_only_from_retained_items(self):
        await self.scenario(retained=("focus",))
        self.assertEqual(self.responses[0].status_code, 200)
        self.assertEqual(self.posts[1], {
            "type": "session.input.message",
            "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "focus"}]}],
        })
        self.assertEqual(self.duplicate.status_code, 200)
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.during["turns"][0]["interjections"][0]["status"], "posted")
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "posted", "confirmed"])
        self.assertEqual(self.repeat_after.json["status"], "confirmed")
        self.assertEqual(self.reloaded["turns"][0]["interjections"], self.archive["turns"][0]["interjections"])
        self.assertIn("focus", self.transcript)

    async def test_completed_new_root_is_adopted_without_resending(self):
        await self.scenario(later=(("turn_late", None, "focus"),))
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(len(self.archive["turns"]), 2)
        first, second = self.archive["turns"]
        self.assertEqual(first["interjections"][0]["status"], "became_turn")
        self.assertEqual(second["from_submission_id"], "submit-0")
        self.assertEqual(second["prompt"], "focus")
        self.assertIn("Adopted answer", second["text"])
        self.assertNotIn("test-secret", json.dumps(self.archive))
        self.assertEqual([e["type"] for e in self.events if e["type"] in {"turn_started", "done"}], ["turn_started", "done"])
        self.assertEqual(self.streams, 2)

    async def test_dropped_202_stays_sending_then_reconciles_without_retry(self):
        await self.scenario(post_status="dropped", retained=("focus",))
        self.assertEqual(self.during["turns"][0]["interjections"][0]["status"], "sending")
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "confirmed"])
        self.assertEqual(len(self.posts), 2)

    async def test_duplicate_text_consumes_distinct_retained_items(self):
        for retained, expected in ((("focus",), ["confirmed", "unconfirmed"]), (("focus", "focus"), ["confirmed", "confirmed"])):
            with self.subTest(retained=retained):
                await self.scenario(texts=("focus", "focus"), retained=retained)
                self.assertEqual([i["status"] for i in self.archive["turns"][0]["interjections"]], expected)
                self.assertEqual(len(self.posts), 3)

    async def test_delegated_turn_is_not_adopted_and_output_is_not_confirmation(self):
        await self.scenario(later=(("turn_child", "subagent-1", "focus"),))
        self.assertEqual(len(self.archive["turns"]), 1)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "unconfirmed")
        self.assertEqual(self.archive["turns"][0]["text"], "Still working")
        self.assertEqual(len(self.posts), 2)

    async def test_conclusive_refusal_is_not_retried(self):
        await self.scenario(post_status=409)
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "refused"])
        self.assertEqual(len(self.posts), 2)
        self.assertNotIn("test-secret", json.dumps(self.events))

    async def test_cancel_marks_pending_interjections_cancelled(self):
        for post_status in (202, "dropped"):
            with self.subTest(post_status=post_status):
                await self.scenario(post_status=post_status, cancel=True)
                self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "cancelled")
                self.assertEqual(self.archive["turns"][0]["outcome"], "cancelled")

    async def test_interjection_text_is_redacted_on_sse_reload_and_fork(self):
        await self.scenario(texts=("focus test-secret",), retained=("focus test-secret",))
        for surface in (self.events, self.responses[0].json, self.reloaded, self.transcript):
            self.assertNotIn("test-secret", str(surface))
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "confirmed")

    async def test_live_adopted_turn_filters_stale_events_and_recovers_missed_prefix(self):
        await self.scenario(later=(("turn_late", None, "focus"),), later_live=True)
        self.assertEqual(self.archive["turns"][1]["text"], "Adopted answer [redacted]")
        self.assertEqual(self.archive["turns"][1]["outcome"], "done")
        self.assertEqual(len(self.posts), 2)

    async def test_concurrent_submission_retries_post_once(self):
        await self.scenario(concurrent=True, retained=("focus", "raced"))
        self.assertTrue(all(r.status_code == 200 for r in self.concurrent))
        self.assertEqual(len(self.posts), 3)
        self.assertEqual(len(self.archive["turns"][0]["interjections"]), 2)

    async def test_delegated_latch_cannot_accept_steering(self):
        await self.scenario(root_subagent="child-1")
        self.assertEqual(self.responses[0].status_code, 409)
        self.assertEqual(self.responses[0].json["code"], "no_active_turn")
        self.assertEqual(len(self.posts), 1)

    async def test_fork_copies_interjections_and_submission_link_in_order(self):
        await self.scenario(texts=("first", "focus"), retained=("first",), later=(("turn_late", None, "focus"),))
        self.assertEqual(self.fork["turns"][:2], self.archive["turns"])
        self.assertIn("client-test, confirmed): first", self.transcript)
        self.assertLess(self.transcript.index("first"), self.transcript.index("focus"))

    async def test_initial_prompt_is_not_interjection_evidence(self):
        await self.scenario(texts=("initial",))
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "unconfirmed")

    async def test_dropped_202_can_become_an_already_completed_new_turn(self):
        await self.scenario(post_status="dropped", later=(("turn_late", None, "focus"),))
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "became_turn"])
        self.assertEqual(self.archive["turns"][1]["outcome"], "done")
        self.assertEqual(len(self.posts), 2)

    async def test_timed_out_post_reconciles_retained_evidence_without_retry(self):
        await self.scenario(post_status="hung", retained=("focus",))
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "confirmed"])
        self.assertEqual(len(self.posts), 2)

    async def test_server_error_without_application_evidence_stays_uncertain(self):
        await self.scenario(post_status=500)
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "unconfirmed"])
        self.assertEqual(len(self.posts), 2)

    async def test_whitespace_distinct_text_is_not_confirmation_or_adoption(self):
        for later in ((), (("turn_late", None, "focus here"),)):
            with self.subTest(later=later):
                await self.scenario(texts=("focus  here",), retained=("focus here",), later=later)
                self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "unconfirmed")
                self.assertEqual(len(self.archive["turns"]), 1)

    async def test_restart_resolves_pending_archive_status_without_resending(self):
        for status in (202, "dropped", 409):
            with self.subTest(status=status):
                await self.scenario(post_status=status, restart=True)
                row = self.restarted_during["turns"][0]["interjections"][0]
                self.assertEqual(row["status"], "refused" if status == 409 else "unconfirmed")
                if status != 409:
                    self.assertIn("restarted", row["detail"])
                self.assertEqual(len(self.posts), 2)

    async def test_stop_during_reconciliation_finds_and_cancels_new_root(self):
        await self.scenario(later=(("turn_late", None, "focus"),), later_live=True, cancel_reconciliation=True)
        self.assertEqual(len(self.archive["turns"]), 2)
        self.assertEqual(self.archive["turns"][1]["outcome"], "cancelled")
        self.assertEqual(self.posts[-1]["type"], "session.input.cancel")
        self.assertEqual(self.events[-1]["type"], "cancelled")

    async def test_paginated_items_and_turns_reconcile_then_adopt_in_order(self):
        await self.scenario(texts=("first", "focus"), retained=("first",),
                            later=(("turn_child", "child-1", "focus"), ("turn_late", None, "focus")), paginated=True)
        self.assertEqual([i["status"] for i in self.archive["turns"][0]["interjections"]], ["confirmed", "became_turn"])
        self.assertEqual(self.archive["turns"][1]["text"], "Adopted answer [redacted]")
        self.assertEqual(len(self.posts), 3)

    async def test_adoption_preserves_each_roots_usage_and_separate_redacted_reasoning(self):
        usages = {"turn_test": {"input_tokens": 11}, "turn_late": {"output_tokens": 7}}
        await self.scenario(later=(("turn_late", None, "focus"),), later_live=True,
                            usage_by_turn=usages, summaries=True)
        first, second = self.archive["turns"]
        self.assertEqual(first["upstreamTurnId"], "turn_test")
        self.assertEqual(second["upstreamTurnId"], "turn_late")
        self.assertEqual(first["usage"], usages["turn_test"])
        self.assertEqual(second["usage"], usages["turn_late"])
        self.assertEqual(first["reasoning"], "Root summary [redacted]")
        self.assertEqual(second["reasoning"], "Adopted summary [redacted]")
        self.assertEqual(self.reloaded["turns"], app.ArchivedChat.model_validate(self.archive).model_dump()["turns"])
        done = next(i for i, e in enumerate(self.events) if e["type"] == "done")
        self.assertTrue(self.events[done]["run_complete"])
        self.assertTrue(all(i > done for i, e in enumerate(self.events) if e["type"] == "usage"))

    async def test_attribution_does_not_consume_steer_started_root_before_adoption(self):
        await self.scenario(
            later=(("turn_late", None, "focus"),), later_live=True, early_root=True,
            summaries=True, save_on_adoption=True,
            capabilities={"delegation": {"enabled": True}, "memory": {"enabled": True},
                          "reasoning_summary": {"enabled": True}},
            usage_by_turn={"turn_test": {"input_tokens": 11}, "turn_late": {"output_tokens": 7}},
        )
        self.assertEqual(len(self.archive["turns"]), 2)
        first, adopted = self.archive["turns"]
        self.assertEqual(first["interjections"][0]["status"], "became_turn")
        self.assertFalse(any(row.get("id") == "early-command" for row in first["activities"]))
        self.assertEqual(adopted["upstreamTurnId"], "turn_late")
        self.assertEqual(adopted["usage"], {"output_tokens": 7})
        self.assertEqual(adopted["reasoning"], "Adopted summary [redacted]")
        self.assertEqual([entry["text"] for entry in self.memories], ["Remember [redacted]"])
        results = [e for e in self.posts if e["type"] == "session.input.tool_result"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["turn_id"], "turn_late")

    async def test_refusal_reason_is_redacted_and_preserved_for_diagnosis(self):
        await self.scenario(post_status=409)
        refusal = next(e for e in self.events if e.get("status") == "refused")
        self.assertEqual(refusal["detail"], "409 active_turn_not_steerable: no steering [redacted]")
        self.assertEqual(self.reloaded["turns"][0]["interjections"][0]["detail"], refusal["detail"])
        self.assertEqual(self.repeat_after.json["detail"], refusal["detail"])
        self.assertEqual(len(self.posts), 2)

    async def test_lifecycle_finalization_retries_with_new_keys_and_adopts_once(self):
        await self.scenario(lifecycle_rejections=2, later=(("turn_late", None, "focus"),))
        self.assertEqual(len(self.posts), 4)
        self.assertTrue(all(self.post_keys[1:]))
        self.assertEqual(len(set(self.post_keys[1:])), 3)
        self.assertEqual(len(self.archive["turns"]), 2)
        self.assertEqual(len(self.archive["turns"][0]["interjections"]), 1)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "became_turn")
        self.assertNotIn("refused", [e.get("status") for e in self.events])

    async def test_lifecycle_retry_stops_after_an_ambiguous_response(self):
        await self.scenario(lifecycle_rejections=1, post_status="dropped")
        self.assertEqual(len(self.posts), 3)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "unconfirmed")

    async def test_stop_cancels_pending_lifecycle_retry(self):
        await self.scenario(lifecycle_rejections=100, cancel=True)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "cancelled")
        self.assertEqual(len([p for p in self.posts if p["type"] == "session.input.message"]), 2)

    async def test_lifecycle_retry_is_bounded_and_rejected_text_is_not_evidence(self):
        await self.scenario(lifecycle_rejections=100, retained=("focus",))
        record = self.archive["turns"][0]["interjections"][0]
        self.assertEqual(record["status"], "refused")
        self.assertIn("did not become ready", record["detail"])
        self.assertLess(len(self.posts), 20)
        self.assertNotIn("confirmed", [e.get("status") for e in self.events])

    async def test_stop_prevents_retries_while_remote_cancellation_drains(self):
        await self.scenario(lifecycle_rejections=100, cancel=True, cancel_delay=0.08)
        self.assertEqual(len([p for p in self.posts if p["type"] == "session.input.message"]), 2)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "cancelled")

    async def test_delayed_lifecycle_rejection_cannot_consume_another_submissions_evidence(self):
        await self.scenario(texts=("focus", "focus"), retained=("focus",), lifecycle_rejections=1, lifecycle_delay=0.03)
        self.assertEqual(len(self.posts), 4)
        self.assertEqual([row["status"] for row in self.archive["turns"][0]["interjections"]], ["unconfirmed", "confirmed"])

    async def test_failed_stop_cancels_old_retries_but_allows_new_steering(self):
        await self.scenario(lifecycle_rejections=1, cancel=True, cancel_failure=True, retained=("fresh",))
        self.assertEqual(self.after_failed_cancel.status_code, 200)
        self.assertEqual(len([p for p in self.posts if p["type"] == "session.input.message"]), 3)
        self.assertEqual([row["status"] for row in self.archive["turns"][0]["interjections"]], ["cancelled", "confirmed"])

    async def test_parent_guard_conflict_retries_same_key_then_adopts_once(self):
        await self.scenario(
            retry_conflicts=("session changed during parent-guarded runtime write",) * 2,
            later=(("turn_late", None, "focus"),),
        )
        self.assertEqual(len(self.posts), 4)
        self.assertTrue(self.post_keys[1])
        self.assertEqual(len(set(self.post_keys[1:])), 1)
        self.assertEqual(self.posts[1:], [self.posts[1]] * 3)
        self.assertEqual(len(self.archive["turns"]), 2)
        self.assertEqual(len(self.archive["turns"][0]["interjections"]), 1)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "became_turn")
        self.assertEqual(self.archive["turns"][1]["from_submission_id"], "submit-0")
        self.assertNotIn("refused", [e.get("status") for e in self.events])

    async def test_parent_guard_conflict_recovers_in_current_turn(self):
        await self.scenario(retry_conflicts=("session changed during parent-guarded runtime write",), retained=("focus",))
        self.assertEqual(len(self.posts), 3)
        self.assertEqual(len(self.archive["turns"]), 1)
        self.assertEqual([e["status"] for e in self.events if e["type"] == "interjection"], ["sending", "posted", "confirmed"])

    async def test_runtime_write_retry_changes_key_only_when_lifecycle_requires_it(self):
        await self.scenario(retry_conflicts=(
            "session changed during parent-guarded runtime write",
            "managed agent turn is awaiting lifecycle finalization; retry with a new Idempotency-Key after it completes",
            "session changed during parent-guarded runtime write",
        ), retained=("focus",))
        self.assertEqual(len(self.posts), 5)
        self.assertEqual(self.post_keys[1], self.post_keys[2])
        self.assertNotEqual(self.post_keys[2], self.post_keys[3])
        self.assertEqual(self.post_keys[3], self.post_keys[4])
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "confirmed")

    async def test_parent_guard_retry_stops_on_ambiguous_delivery(self):
        for status in ("dropped", 500):
            with self.subTest(status=status):
                await self.scenario(retry_conflicts=("session changed during parent-guarded runtime write",), post_status=status)
                self.assertEqual(len(self.posts), 3)
                self.assertEqual(self.post_keys[1], self.post_keys[2])
                self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "unconfirmed")

    async def test_parent_guard_retries_are_bounded_and_stop_cancels_them(self):
        for stop in (False, True):
            with self.subTest(stop=stop):
                await self.scenario(retry_conflicts=("session changed during parent-guarded runtime write",) * 100, cancel=stop, cancel_delay=0.08)
                message_keys = [key for post, key in zip(self.posts[1:], self.post_keys[1:]) if post["type"] == "session.input.message"]
                self.assertEqual(len(set(message_keys)), 1)
                self.assertLess(len(message_keys), 20)
                self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "cancelled" if stop else "refused")
                if stop:
                    self.assertEqual(len(message_keys), 1)

    async def test_unknown_conflict_is_not_retried(self):
        await self.scenario(retry_conflicts=("some other conflict",))
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.archive["turns"][0]["interjections"][0]["status"], "refused")

    async def test_steering_position_uses_redacted_text_and_survives_status_reload_and_fork(self):
        await self.scenario(leading_text="Before 🐶 test-secret then \n", retained=("focus",))
        position = len("Before 🐶 [redacted] then \n")
        self.assertEqual(self.responses[0].json["text_offset"], position)
        for frame in self.events:
            if frame["type"] == "interjection":
                self.assertEqual(frame["text_offset"], position)
        for archive in (self.archive, self.reloaded, self.fork):
            self.assertEqual(archive["turns"][0]["interjections"][0]["text_offset"], position)
