import asyncio
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app


class ForkStartupTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.source = SimpleNamespace(
            create_snapshot=AsyncMock(return_value=SimpleNamespace(snapshot_id="snapshot-test")),
            beta_pause=AsyncMock(),
        )
        self.clone = SimpleNamespace(
            sandbox_id="sandbox-child", kill=AsyncMock(),
            commands=SimpleNamespace(run=AsyncMock()),
            files=SimpleNamespace(write=AsyncMock()),
        )
        self.parent = app.DemoSession(chat_id="parent-test", client_id="client-test", api_key="test")
        self.parent.session_id = "session-parent"
        self.parent.sandbox_id = "sandbox-parent"
        self.parent.sandbox = self.source
        self.client = SimpleNamespace(
            sessions=SimpleNamespace(
                retrieve=AsyncMock(),
                create=AsyncMock(return_value=SimpleNamespace(id="session-child")),
            ), aclose=AsyncMock(),
        )
        async def run(command, **kwargs):
            if kwargs.get("background"):
                kwargs["on_stderr"](app.RENDEZVOUS_MARKER)
                return SimpleNamespace(exit_code=None)
        self.clone.commands.run.side_effect = run
        for owner, name, value in [
            (app, "AgentAPISDK", lambda **kwargs: self.client),
            (app, "session_environment_id", lambda session: "environment-child"),
            (app, "read_session_capabilities", lambda *args: None),
            (app, "render_parent_transcript", AsyncMock(return_value="")),
            (app, "start_mcp_gateway", AsyncMock()),
            (app, "refine_wake", AsyncMock()),
            (app, "save_chat_record", lambda child: None),
            (app, "sessions", {}),
            (app, "chat_history", app.ChatHistory(Path(directory))),
            (app, "delete_remote_session", AsyncMock()),
            (app.AsyncSandbox, "connect", AsyncMock(return_value=self.source)),
            (app.AsyncSandbox, "create", AsyncMock(return_value=self.clone)),
            (app.AsyncSandbox, "delete_snapshot", AsyncMock()),
        ]:
            self.stack.enter_context(patch.object(owner, name, value))

    async def fork(self):
        return await app.fork_chat_async(self.parent, "child-test", "client-test")

    async def test_session_setup_overlaps_checkpoint(self):
        session_started = asyncio.Event()
        async def create(**kwargs):
            session_started.set()
            return SimpleNamespace(id="session-child")
        async def checkpoint():
            await asyncio.wait_for(session_started.wait(), timeout=0.1)
            return SimpleNamespace(snapshot_id="snapshot-test")
        self.client.sessions.create.side_effect = create
        self.source.create_snapshot.side_effect = checkpoint
        child = await self.fork()
        self.assertEqual(child.session_id, "session-child")
        self.clone.files.write.assert_awaited_once()

    async def test_inherited_executor_is_fenced_once_before_snapshot_cleanup(self):
        stops_at_cleanup = []
        async def delete(snapshot_id):
            stops_at_cleanup.extend(self.clone.commands.run.call_args_list)
        app.AsyncSandbox.delete_snapshot.side_effect = delete
        await self.fork()
        stops = [call for call in self.clone.commands.run.call_args_list
                 if call.args[0].startswith("pkill")]
        self.assertEqual(len(stops), 1)
        self.assertEqual(stops_at_cleanup, stops)

    async def test_wake_measures_create_without_fencing_or_cleanup(self):
        clock = SimpleNamespace(
            monotonic=lambda: elapsed[0], time=app.time.time,
            monotonic_ns=app.time.monotonic_ns,
        )
        elapsed = [0.0]
        async def create(*args, **kwargs):
            elapsed[0] += 0.5
            return self.clone
        async def delete(snapshot_id):
            elapsed[0] += 2
        app.AsyncSandbox.create.side_effect = create
        app.AsyncSandbox.delete_snapshot.side_effect = delete
        with patch.object(app, "time", clock):
            child = await self.fork()
        self.assertEqual(child.last_wake["ms"], 500)

    async def test_clone_failure_drains_session_creation_before_rollback(self):
        checkpoint_failed = asyncio.Event()
        async def create(**kwargs):
            await checkpoint_failed.wait()
            await asyncio.sleep(0)
            return SimpleNamespace(id="session-child")
        async def checkpoint():
            checkpoint_failed.set()
            raise RuntimeError("checkpoint failed")
        self.client.sessions.create.side_effect = create
        self.source.create_snapshot.side_effect = checkpoint
        with self.assertRaisesRegex(RuntimeError, "checkpoint failed"):
            await self.fork()
        app.delete_remote_session.assert_awaited_once()
        self.assertEqual(app.delete_remote_session.call_args.args[0].session_id, "session-child")
        self.assertEqual(app.sessions, {})

    async def test_cancellation_drains_session_creation_and_reaps_clone(self):
        session_started = asyncio.Event()
        release_session = asyncio.Event()
        clone_fenced = asyncio.Event()
        async def create(**kwargs):
            session_started.set()
            await release_session.wait()
            return SimpleNamespace(id="session-child")
        async def run(*args, **kwargs):
            clone_fenced.set()
        self.client.sessions.create.side_effect = create
        self.clone.commands.run.side_effect = run
        task = asyncio.create_task(self.fork())
        await asyncio.wait_for(session_started.wait(), timeout=1)
        await asyncio.wait_for(clone_fenced.wait(), timeout=1)
        task.cancel()
        await asyncio.sleep(0)
        release_session.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        app.delete_remote_session.assert_awaited_once()
        self.clone.kill.assert_awaited_once()
        self.assertEqual(app.sessions, {})

    async def test_paused_parent_is_returned_to_sleep(self):
        self.parent.paused = True
        self.parent.sandbox = None
        await self.fork()
        self.source.beta_pause.assert_awaited_once()
        self.assertTrue(self.parent.paused)
        self.assertIsNone(self.parent.sandbox)

    async def test_session_failure_reaps_clone(self):
        self.client.sessions.create.side_effect = RuntimeError("session failed")
        with self.assertRaisesRegex(RuntimeError, "session failed"):
            await self.fork()
        self.clone.kill.assert_awaited_once()
        app.AsyncSandbox.delete_snapshot.assert_awaited_once_with("snapshot-test")
        self.assertEqual(app.sessions, {})
