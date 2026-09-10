# OpenAI Agents API + E2B: webhook-managed sandboxes

OpenAI runs the agent and keeps session state. A small **controller** running in
its own E2B sandbox receives OpenAI webhooks and starts, resumes, or pauses a
separate **worker** E2B sandbox per Agents API session. Agent commands run only in
the worker. The application (`client.py`) never imports the E2B SDK.

This is the E2B variant of OpenAI's
[webhook-managed sandbox example](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed)
(`deploy.py` is verbatim; `client.py` pins the SDK to the git repo instead of a
relative path; `handler.py` creates workers from the
`openai-agents-api-python-sdk-webhook-managed` E2B template instead of the base
image, and pauses a failed session's worker where upstream kills it, so the
sandbox can be inspected afterwards). For the application-managed alternative, where
your own process provisions the sandbox, see the sibling
[openai-agents-api-python-sdk](../openai-agents-api-python-sdk) workbench.

```
client.py          create agent / session, send input, stream the turn   (your app)
build_template.py  build the worker image with codex baked in            (one-off)
deploy.py          put handler.py into a public E2B sandbox and run it   (one-off)
handler.py         FastAPI webhook receiver + SQLite job queue           (controller)
```

## How a turn flows

1. `client.py` creates a `self_hosted` session and posts input.
2. OpenAI emits `agent.session.action_required` (`environment_connection`) to the
   controller **before** waiting for the executor (wait is up to five minutes).
3. The controller verifies the signature, queues the session ID, then reconciles:
   it re-reads the session from the API and, only if the action is still pending,
   creates a worker from the template (or resumes a paused one, found by
   `agents-session-id` metadata) and launches `codex exec-server` inside it with
   the executor key.
4. The executor connects, the turn runs, the client streams output.
5. `agent.session.failed` pauses that session's worker (upstream kills it) so you
   can inspect it; kill it yourself when done. Nothing runs on `idle`.

## Setup

Requires [uv](https://docs.astral.sh/uv/). Every script declares its own
dependencies inline, so `uv run` installs them.

```sh
cp .env.example .env   # fill in the keys below
```

| Variable | Used by |
| --- | --- |
| `OPENAI_API_KEY` | client (creates sessions) and controller (reads session state) |
| `OPENAI_EXECUTOR_API_KEY` | the only credential that enters a worker, as `CODEX_API_KEY`. Restricted key: List models -> Read, all else None. Same org, project, and user or service account as the application key. |
| `OPENAI_AGENT_ID` | client and controller; the controller ignores sessions of other agents |
| `E2B_API_KEY` | deploy (controller sandbox) and controller (worker sandboxes) |
| `OPENAI_WEBHOOK_SECRET` | controller; set after registering the webhook |

1. Create an agent and put its ID in `.env`:

   ```sh
   uv run --env-file .env client.py --create-agent openai-agents-api-python-sdk-webhook-managed
   ```

2. Build the worker template (once per codex version; see `CODEX_VERSION` in
   `build_template.py`). The controller creates every worker from it:

   ```sh
   uv run --env-file .env build_template.py
   ```

   Override the name with `E2B_WORKER_TEMPLATE` for both the build and the
   controller; the handler falls back to installing codex at boot if the
   template lacks it, so the default E2B image also works, just slower.

3. Deploy the controller (leave `OPENAI_WEBHOOK_SECRET` empty for now):

   ```sh
   uv run --env-file .env deploy.py
   # Webhook: https://8000-<sandbox-id>.e2b.app/webhook
   ```

   The sandbox ID is saved to the ignored `.controller.json`; rerunning
   `deploy.py` reconnects and restarts the same controller with fresh envs. If
   that sandbox is gone, it creates a new one and prints the new webhook URL.

4. Register that URL in **OpenAI platform -> Project settings -> Webhooks** for
   `agent.session.action_required` and `agent.session.failed`. **Pick the
   project that owns `OPENAI_API_KEY`**; a webhook in another project of the same
   org is never delivered, and the first input then fails after the five-minute
   wait with `500 internal_error`. (E2B's own Webhooks page is unrelated: that is
   for outgoing sandbox lifecycle events.)

5. Put the signing secret in `.env` and redeploy:

   ```sh
   uv run --env-file .env deploy.py
   ```

   Sanity check: `curl -X POST <webhook-url> -d '{}'` returns
   `{"error":"Invalid signature"}` (400). Before the secret is installed it returns
   `{"error":"Webhook not configured"}` (503).

## Run

```sh
set -a; . ./.env; set +a
uv run --env-file .env client.py --agent-id "$OPENAI_AGENT_ID" \
  --input "Use the shell to write hello to /workspace/hello.txt, then read it."
```

The first line printed is `{"session_id": "sess_..."}`. Keep it for follow-ups:

```sh
uv run --env-file .env client.py --session-id "$SESSION_ID" \
  --input "Read /workspace/hello.txt again."
```

Workers stay running between turns. Pause the worker in E2B (or let it hit its
30-minute timeout) and the next input makes the handler resume it with files
intact; a killed worker is replaced by a fresh one without previous files.

Observed on 2026-09-03: the reconnect webhook fires only after OpenAI has noticed
the executor is offline, which lagged a kill by a few minutes. Input sent in that
window runs without a shell (the agent reports shell access unavailable, no
`command_execution` item appears) and the session's later turns kept declining to
retry the shell even after a replacement worker connected. A new session on the
same agent worked immediately. Give a stopped worker a few minutes before sending
follow-up input, or start a new session.

## Inspect

- Controller log: `/app/controller.log` in the controller sandbox (JSON lines for
  `enqueued` and `started`, plus uvicorn access lines).
- Executor log: `/tmp/codex-executor.log` in each worker.
- Workers carry metadata `agents-session-id=<session>`; the controller sandbox
  carries `agents-webhook-controller=e2b`.

## Cleanup

There is no session-deletion webhook, so release both sides yourself:

```sh
uv run --env-file .env client.py --session-id "$SESSION_ID" --delete
e2b sandbox kill <worker-id>       # including paused workers
```

Workers have a 30-minute running timeout (refreshed on reconnect). The controller
has a one-hour timeout, extended on every `deploy.py`; its SQLite queue survives a
process restart, not sandbox deletion. Remove the OpenAI webhook before killing
the controller for good. If the controller expires, rerun `deploy.py`; it
creates a new one and the URL changes, so update the OpenAI webhook too.
