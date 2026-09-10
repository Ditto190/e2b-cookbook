import unittest
from unittest.mock import patch

import app


class RecoveryTest(unittest.TestCase):
    def test_recovery_fork_stays_at_source_tree_level(self) -> None:
        root = app.DemoSession(
            chat_id="rootchat", client_id="client123", api_key="test"
        )
        child = app.DemoSession(
            chat_id="childchat",
            client_id="client123",
            api_key="test",
            parent_chat_id="parentchat",
        )

        self.assertIsNone(
            app.recovery_parent_chat_id(root, promote=False, sibling=True)
        )
        self.assertEqual(
            app.recovery_parent_chat_id(child, promote=False, sibling=True),
            "parentchat",
        )
        self.assertEqual(
            app.recovery_parent_chat_id(child, promote=False, sibling=False),
            "childchat",
        )
        self.assertIsNone(
            app.recovery_parent_chat_id(child, promote=True, sibling=True)
        )

    def test_terminal_chat_rejects_turn_before_external_work(self) -> None:
        demo = app.DemoSession(
            chat_id="deadchat", client_id="client123", api_key="test"
        )
        demo.session_id = "sess_dead"
        demo.sandbox_id = "sandbox_dead"
        demo.terminal_reason = "decayed"

        with (
            app.app.test_client() as client,
            patch.object(app, "get_or_create_demo", return_value=demo),
        ):
            response = client.post(
                "/api/chat",
                json={
                    "client_id": "client123",
                    "chat_id": "deadchat",
                    "prompt": "continue",
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "decayed")
        self.assertFalse(demo.turn_lock.locked())


if __name__ == "__main__":
    unittest.main()
