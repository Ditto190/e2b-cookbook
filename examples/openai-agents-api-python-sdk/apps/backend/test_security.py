"""The two things that keep an exposed workbench sandbox safe: which key the
executor gets, and who may call /api at all."""

import os
import tempfile
import unittest
from unittest.mock import patch

os.environ["WORKBENCH_CONTROL_DIR"] = tempfile.mkdtemp()

import app  # noqa: E402
import auth  # noqa: E402
from chat_logs import ChatLog  # noqa: E402

DISPATCHER = "sk-dispatcher-000000000000"
EXECUTOR = "sk-executor-1111111111111"


class ExecutorKeyTest(unittest.TestCase):
    def test_host_chats_get_the_dedicated_executor_key(self) -> None:
        with patch.object(app, "DEFAULT_OPENAI_KEY", DISPATCHER), patch.object(
            app, "DEFAULT_EXECUTOR_KEY", EXECUTOR
        ):
            self.assertEqual(app.resolve_executor_key(DISPATCHER), EXECUTOR)

    def test_a_pasted_key_stays_on_both_sides(self) -> None:
        # exec-server registers against the environment the dispatcher key
        # created, so the two must share an OpenAI project — a chat on its own
        # key cannot borrow the host's executor key.
        with patch.object(app, "DEFAULT_OPENAI_KEY", DISPATCHER), patch.object(
            app, "DEFAULT_EXECUTOR_KEY", EXECUTOR
        ):
            self.assertEqual(app.resolve_executor_key("sk-someone-else"), "sk-someone-else")

    def test_no_executor_key_falls_back_to_the_dispatcher_key(self) -> None:
        with patch.object(app, "DEFAULT_OPENAI_KEY", DISPATCHER), patch.object(
            app, "DEFAULT_EXECUTOR_KEY", ""
        ):
            self.assertEqual(app.resolve_executor_key(DISPATCHER), DISPATCHER)

    def test_both_keys_are_scrubbed_from_output(self) -> None:
        demo = app.DemoSession(
            chat_id="chat1234",
            client_id="client123",
            api_key=DISPATCHER,
            executor_api_key=EXECUTOR,
        )
        leaked = f"CODEX_API_KEY={EXECUTOR} OPENAI_API_KEY={DISPATCHER}"
        self.assertNotIn(EXECUTOR, app.redact_for_demo(demo, leaked))
        self.assertNotIn(DISPATCHER, app.redact_for_demo(demo, leaked))

        # Streamed in pieces, the split landing mid-key.
        redactor = app.SecretStreamRedactor(DISPATCHER, EXECUTOR)
        out = redactor.feed(leaked[:30]) + redactor.feed(leaked[30:]) + redactor.finish()
        self.assertNotIn(EXECUTOR, out)
        self.assertNotIn(DISPATCHER, out)

    def test_chat_log_scrubs_both_keys(self) -> None:
        log = ChatLog(DISPATCHER, EXECUTOR)
        log.publish(
            source="executor", stream="stdout", text=f"env: {EXECUTOR}\n", channel="c"
        )
        text = log.recent_text(source="executor", stream="stdout", limit=1000)
        self.assertNotIn(EXECUTOR, text)
        self.assertIn("[redacted]", text)


class AuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.app.test_client()
        patcher = patch.dict(os.environ, {"WORKBENCH_CONTROL_TOKEN": "control-secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_protected_routes_401_without_a_session(self) -> None:
        response = self.client.post("/api/keys", json={"openai_api_key": "sk-nope"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "unauthorized")

    def test_mcp_catalog_is_behind_the_gate(self) -> None:
        # Static metadata, but the picker is workbench UI — same gate as
        # /api/models, not a second boot probe.
        self.assertEqual(self.client.get("/api/mcp/servers").status_code, 401)
        self.client.post("/api/auth/login", json={"token": "control-secret"})
        self.assertEqual(self.client.get("/api/mcp/servers").status_code, 200)

    def test_health_stays_open_as_the_boot_probe(self) -> None:
        body = self.client.get("/api/health").get_json()
        self.assertTrue(body["auth_required"])
        self.assertFalse(body["authenticated"])

    def test_control_token_opens_a_session(self) -> None:
        login = self.client.post("/api/auth/login", json={"token": "control-secret"})
        self.assertEqual(login.status_code, 200)
        # The cookie now rides along on the test client.
        self.assertTrue(self.client.get("/api/health").get_json()["authenticated"])

    def test_bad_token_is_refused(self) -> None:
        self.assertEqual(
            self.client.post("/api/auth/login", json={"token": "guess"}).status_code, 401
        )

    def test_launch_token_works_exactly_once(self) -> None:
        token = auth.create_launch_token()
        self.assertEqual(
            self.client.post("/api/auth/login", json={"token": token}).status_code, 200
        )
        self.assertEqual(
            self.client.post("/api/auth/login", json={"token": token}).status_code, 401
        )

    def test_expired_launch_token_is_refused(self) -> None:
        token = auth.create_launch_token(ttl_seconds=-1)
        self.assertFalse(auth.verify_token(token))

    def test_invite_requires_a_session(self) -> None:
        self.assertEqual(self.client.post("/api/auth/invite").status_code, 401)
        self.client.post("/api/auth/login", json={"token": "control-secret"})
        invite = self.client.post("/api/auth/invite").get_json()
        self.assertIn("#token=", invite["url"])

    def test_rotating_the_control_token_revokes_sessions(self) -> None:
        self.client.post("/api/auth/login", json={"token": "control-secret"})
        with patch.dict(os.environ, {"WORKBENCH_CONTROL_TOKEN": "rotated"}):
            self.assertFalse(self.client.get("/api/health").get_json()["authenticated"])

    def test_auth_disabled_leaves_every_route_open(self) -> None:
        with patch.dict(os.environ, {"WORKBENCH_CONTROL_TOKEN": ""}), patch.object(
            auth, "CONTROL_DIR", auth.CONTROL_DIR / "does-not-exist"
        ):
            body = self.client.get("/api/health").get_json()
            self.assertFalse(body["auth_required"])
            self.assertTrue(body["authenticated"])


if __name__ == "__main__":
    unittest.main()
