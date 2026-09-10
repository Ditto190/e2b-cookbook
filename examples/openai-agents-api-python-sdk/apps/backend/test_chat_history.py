import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app
from chat_history import ChatHistory, HistoryQueue


class ChatHistoryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.history = ChatHistory(Path(self.directory.name))
        patcher = patch.object(app, "chat_history", self.history)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_stream_survives_absent_reader_and_restart(self):
        self.history.begin("chat1234", "Build a page")
        output = HistoryQueue(self.history, "chat1234")
        output.put(
            {"type": "activity", "id": "command1", "tone": "muted", "label": "Running"}
        )
        output.put(
            {
                "type": "activity",
                "id": "command1",
                "tone": "success",
                "label": "Finished",
            }
        )
        output.put({"type": "delta", "text": "First "})
        output.put({"type": "delta", "text": "answer"})
        output.put({"type": "done"})
        output.put({"type": "stream_end"})
        restored = ChatHistory(Path(self.directory.name)).get("chat1234")
        self.assertEqual(restored["turns"][0]["text"], "First answer")
        self.assertEqual(restored["turns"][0]["outcome"], "done")
        self.assertEqual(len(restored["turns"][0]["activities"]), 1)
        self.assertEqual(restored["turns"][0]["activities"][0]["label"], "Finished")
        self.assertEqual(list(Path(self.directory.name).glob("*.tmp")), [])

    def test_interrupted_turn_keeps_partial_text_on_restart(self):
        self.history.begin("chat1234", "Build")
        self.history.apply("chat1234", {"type": "text", "text": "Partial answer"})
        self.history.metadata("chat1234", sandboxId="sandbox-id")
        restored = ChatHistory(Path(self.directory.name)).get("chat1234")
        self.assertEqual(restored["turns"][0]["outcome"], "error")
        self.assertEqual(restored["turns"][0]["text"], "Partial answer")
        self.assertEqual(restored["sandboxId"], "sandbox-id")

    def test_fork_copies_server_history_and_reparents_recovery_children(self):
        self.history.begin("parent12", "Shared prompt")
        self.history.apply("parent12", {"type": "text", "text": "Shared answer"})
        self.history.apply(
            "parent12",
            {
                "type": "error",
                "message": "decayed",
                "code": "decayed",
                "terminal": True,
            },
        )
        child = self.history.prepare_fork(
            "parent12",
            "child123",
            parent_chat_id="parent12",
            sandbox_id="sandbox-child",
            session_id="session-child",
            sibling=False,
        )
        self.history.save_fork("parent12", child, promote=False, sibling=False)
        self.assertEqual(child["turns"][0]["text"], "Shared answer")
        recovered = self.history.prepare_fork(
            "parent12",
            "recover1",
            parent_chat_id=None,
            sandbox_id="sandbox-new",
            session_id="session-new",
            sibling=True,
        )
        self.history.save_fork("parent12", recovered, promote=False, sibling=True)
        self.assertEqual(self.history.get("child123")["parentChatId"], "recover1")
        self.assertIsNone(recovered["parentChatId"])
        self.assertEqual(
            recovered["turns"][-1]["activities"][0]["label"], "Recovered from sandbox"
        )
        self.history.begin("recover1", "Continue")
        self.assertNotEqual(
            self.history.get("parent12")["turns"][-1]["prompt"], "Continue"
        )

    def test_two_authenticated_browsers_read_same_archive_and_import_is_insert_only(
        self,
    ):
        with (
            patch.object(app.auth, "auth_enabled", return_value=True),
            patch.object(app.auth, "session_valid", return_value=True),
        ):
            browser_one = app.app.test_client()
            browser_two = app.app.test_client()
            self.history.begin("chat1234", "Shared prompt")
            self.history.apply("chat1234", {"type": "done"})
            record = browser_one.get("/api/chats").get_json()["chats"][0]
            self.assertEqual(
                browser_two.get("/api/chats").get_json()["chats"][0], record
            )
            record["turns"][0]["prompt"] = "Stale browser"
            self.assertEqual(
                browser_two.post(
                    "/api/chats/import", json={"chats": [record]}
                ).status_code,
                200,
            )
            self.assertEqual(
                self.history.get("chat1234")["turns"][0]["prompt"], "Shared prompt"
            )
            record["id"] = "legacy12"
            self.assertEqual(
                browser_one.post(
                    "/api/chats/import", json={"chats": [record]}
                ).status_code,
                200,
            )
            self.assertIsNotNone(ChatHistory(Path(self.directory.name)).get("legacy12"))

    def test_archive_routes_require_auth_and_reject_path_traversal(self):
        with (
            app.app.test_client() as client,
            patch.object(app.auth, "auth_enabled", return_value=True),
            patch.object(app.auth, "session_valid", return_value=False),
        ):
            self.assertEqual(client.get("/api/chats").status_code, 401)
            self.assertEqual(
                client.post("/api/chats/import", json={"chats": []}).status_code, 401
            )
        with (
            app.app.test_client() as client,
            patch.object(app.auth, "auth_enabled", return_value=False),
        ):
            bad = {
                "id": "../outside",
                "title": "bad",
                "createdAt": 1,
                "updatedAt": 1,
                "turns": [],
            }
            self.assertEqual(
                client.post("/api/chats/import", json={"chats": [bad]}).status_code, 400
            )

    def test_reset_deletes_archive_without_live_session(self):
        self.history.begin("chat1234", "Old prompt")
        with (
            app.app.test_client() as client,
            patch.object(app, "get_demo", return_value=None),
            patch.object(app, "chat_records", {}),
            patch.object(app.auth, "auth_enabled", return_value=False),
        ):
            response = client.post(
                "/api/reset", json={"client_id": "newbrowser", "chat_id": "chat1234"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(ChatHistory(Path(self.directory.name)).get("chat1234"))

    def test_executor_receives_coordinator_history_without_credentials(self):
        self.history.begin("chat1234", "Continue")
        self.history.apply("chat1234", {"type": "text", "text": "Secret sk-test"})
        sandbox = AsyncMock()
        demo = app.DemoSession(
            chat_id="chat1234",
            client_id="client123",
            api_key="sk-test",
            sandbox=sandbox,
        )
        asyncio.run(app.sync_executor_history(demo))
        path, contents = sandbox.files.write.call_args.args
        self.assertEqual(path, "/workspace/.workbench/chat.json")
        self.assertEqual(json.loads(contents)["turns"][0]["prompt"], "Continue")
        self.assertNotIn("sk-test", contents)

    def test_fork_context_uses_archive_when_upstream_is_unavailable(self):
        self.history.begin("chat1234", "Remember this prompt")
        self.history.apply("chat1234", {"type": "text", "text": "Remember this answer"})
        demo = app.DemoSession(
            chat_id="chat1234", client_id="client123", api_key="test"
        )
        client = AsyncMock()
        appendix = asyncio.run(app.render_parent_transcript(client, demo))
        self.assertIn("Remember this answer", appendix)
        client.sessions.list_items.assert_not_called()


if __name__ == "__main__":
    unittest.main()
