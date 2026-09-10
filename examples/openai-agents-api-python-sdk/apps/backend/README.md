# Agents API Workbench — Backend

Flask backend for the Agents API workbench: chat with an OpenAI Agents API
agent that works inside a real E2B sandbox, with live activity and a workspace
file viewer. This server is the JSON/SSE API; the React app in
[`../web`](../web/) is the UI (proxied here via Vite's `/api` proxy).

Authors: Matthew Brockman & Ondrej Drapalik

## Session lifecycle

Each chat:

1. Creates a self-hosted Agents API session (`https://api.openai.com/v1/agents`).
2. Creates an E2B sandbox from the public `e2b/openai-agents-api-executor`
   template (codex preinstalled, see `template/executor`; override with
   `E2B_AGENTS_TEMPLATE`).
3. Starts `codex exec-server --remote … --environment-id …` inside the sandbox
   via `sandbox.commands.run(background=True, timeout=0)`.
4. Streams the turn over SSE; the file viewer reads `/workspace` from the
   sandbox over the E2B API (one `find` RPC for the tree, `files.read` for
   contents).

Chats are resumable: idle sandboxes auto-pause instead of dying, and
session/sandbox ids persist in `chats-state.json` across backend restarts.
Shared transcripts and fork metadata live in `chat-history/<chat-id>.json`.
`GET /api/chats` reads the archive; `POST /api/chats/import` migrates legacy
browser records without replacing existing chats. These routes use the same
workbench authentication as the other APIs. The backend records SSE events
at their producer so a browser disconnect does not stop persistence.

## Run

```bash
uv sync
make run   # http://127.0.0.1:8000
```

Required env (see `.env.example`; `env.py` loads `apps/backend/.env`):

- `E2B_API_KEY` — sandbox control
- `OPENAI_API_KEY` — **dispatcher** key; must have Agents API preview access
  (keys without it 404 on every `/v1/agents/*` route). Never leaves this
  process.
- `OPENAI_EXECUTOR_API_KEY` — **executor** key, optional. The only credential
  passed into a sandbox (`CODEX_API_KEY`), so scope it down; must be in the
  same OpenAI project as the dispatcher key, since exec-server registers
  against the environment that key created. Unset falls back to
  `OPENAI_API_KEY`. Chats running on a user-pasted key keep using that key on
  both sides (`resolve_executor_key`).

Booting without keys works: the UI opens a key gate and accepts all three at
runtime. Runtime-supplied keys live in process memory only — never written to
disk or logs. Both keys are scrubbed from executor output, file previews and
error messages (`SecretStreamRedactor`, `redact_for_demo`).

## Auth

`auth.py` gates every `/api` route except `/api/health`, `/api/auth/status`
and `/api/auth/login` behind a session cookie. It activates only when a
control token resolves — `WORKBENCH_CONTROL_TOKEN`, or
`$WORKBENCH_CONTROL_DIR/control-token` (written by `template/start.sh` in the
sandbox image). Local runs configure neither, so the gate is off.

- `POST /api/auth/login` takes the control token or a single-use, 10-minute
  launch token and sets a 12-hour `HttpOnly; SameSite=Strict` cookie signed
  (HMAC-SHA256) with the control token. Rotating the token revokes every
  session.
- `POST /api/auth/invite` mints a share link — how a second person gets in
  without being handed the control token.
- `python auth.py` prints a fresh one-click launch URL (used by the sandbox
  terminal banner).

Launch tokens are stored as SHA-256 digests only, and claimed with an atomic
rename so a leaked URL cannot be replayed.

## MCP servers

Each chat picks its own MCP servers. `mcp_servers.py` is the catalog;
`GET /api/mcp/servers` serves it to the picker (label, name, description,
origin, launch command) so the UI hardcodes nothing.

New chats select Hacker News, Context7, DeepWiki, and OpenAI Docs, with tool
search enabled. Explicit MCP tests acknowledge the requested servers, make
individual tool calls, and report errors without substituting web results.
Selections can be saved during a running turn. The latest saved selection
applies automatically after that turn, before another prompt starts. Failed
reconnections retain the previous MCPs and show a retry message in the UI.

| label | origin | how it connects |
| --- | --- | --- |
| `openai_docs` | `service` | OpenAI's service dials `https://developers.openai.com/mcp` |
| `context7`, `deepwiki`, `hackernews` | `gateway` | Pinned E2B catalog entries; remote entries are proxied by the gateway |
| `duckduckgo` | `environment` | `uvx duckduckgo-mcp-server` in the sandbox |
| `wikipedia` | `environment` | `uvx wikipedia-mcp` in the sandbox |
| `time` | `environment` | `uvx mcp-server-time --local-timezone=UTC` in the sandbox |
| every other id | `gateway` | E2B's hosted catalog (~220 servers), served by `mcp-gateway` on sandbox loopback |

`gateway` servers are [E2B's hosted MCP catalog][catalog], read at import off
the installed SDK's `e2b.sandbox.mcp.McpServer` TypedDict: one member per
server, its docstring the description, its value type the config object whose
fields (`apiKey`, `projectId`, ...) become the picker's option inputs. The
catalog therefore tracks the SDK version, not a hand-kept list; a gateway id
that collides with a hand-listed label above is skipped so labels stay unique.
Before launching exec-server — on first turn, resume and fork — the coordinator
starts `mcp-gateway --config` with only the servers that chat picked and that
chat's option values as each server's config. Images pull on first use;
`template/executor/mcp-catalog.json` names the few the template build caches
with [`addMcpServer()`][addmcpserver] (`prepulled: true` in the catalog) so
they start instantly. Only `server`-type catalog entries can be prepulled — a
remote-type id (`context7`, `deepwiki`, `gitmcp`, `llmtxt`) fails the build
with `is type "remote"; expected "server"` — but every entry runs at runtime,
which is how the rest of the catalog works without a rebuild.

Before starting the gateway, `mcp_gateway_compat.py` repairs older catalogs:
DeepWiki uses its current streamable HTTP endpoint, and Context7 omits the
unresolved API-key placeholder so anonymous access works. Context7's
anonymous rate limits still apply.

The whole selection reaches the agent as ONE `mcp` tool, `e2b_gateway`.
The executor launches `uvx --with mcp==1.26.0 mcp-proxy==0.11.0 --transport
streamablehttp http://127.0.0.1:50005/mcp` over stdio. This bridge avoids a
reproducible `internal_error` during the direct environment HTTP/SSE handshake
with codex `0.145.0-alpha.24`. Both dependencies are pinned because newer MCP
SDKs removed APIs this proxy imports. The sandbox needs `uvx` and PyPI egress
on first use; no executor template rebuild is needed.

The bridge reads its bearer token from `API_ACCESS_TOKEN`, supplied to the
executor and inherited through `transport.env_vars`. The session payload
contains only the variable name. The token is HMAC-SHA256 over the chat id and the executor credential: never
stored, recomputed after a restart, distinct per fork, and scrubbed by every
log and text redactor. That entry is `required` — if the gateway cannot start,
the turn is refused with a clear error instead of quietly losing the tools.

Sessions created before this transport fix retain their HTTP tool configuration.
Start a new chat or fork the failed chat to use the bridge; forks keep the
workspace and selected servers.

**Option values (API keys).** The picker saves credentials explicitly through
`POST /api/mcp/credentials`. They remain in workbench process memory, reusable
across chats; `GET /api/mcp/credentials` returns only configured-field markers.
Blank replacement fields keep their current values. Required fields and option
names are validated before saving. Secrets are redacted from logs and streamed
output. Snapshots, archives, and restart records mask options to `•`; users must
save credentials again after a backend restart. No credential values go into
browser storage. A picked server missing a required field counts as not
configured: the picker shows it unselected and never saves it, and a new chat
skips it rather than refusing to start (`configured_servers`). Only a resumed
chat, whose tools were bound with that server, still gets the
`MCP servers need config` error.

**Changing MCPs in a started chat.** `POST /api/mcp/selection` reserves the
chat's turn lock and refuses changes while a turn is running. The preview API
cannot edit a session's tools, so the coordinator creates a replacement agent
session, includes recent transcript context, and reconnects the same sandbox.
The chat ID, visible transcript, and workspace stay intact; full history is
available in `.workbench/chat.json`. Upstream session/environment IDs change,
and subagent state starts fresh. If reconnecting fails, the previous session
and configuration are restored. New-chat defaults stay independent.

[catalog]: https://docs.e2b.dev/mcp-gateway/quickstart
[addmcpserver]: https://docs.e2b.dev/sdk-reference/js-sdk/v2.38.2/template#addmcpserver

`environment` servers run as stdio subprocesses inside the E2B sandbox
(`codex exec-server` spawns them), so the sandbox is the gateway: they need
`uvx` on its PATH — override with `MCP_STDIO_LAUNCHER` — plus egress for uvx's
first fetch, and they exist only while the executor does. They are declared
`required: false`, so one that cannot start drops its own tools instead of
failing the turn.

Selection travels as a capability:

```jsonc
POST /api/chat
{ "capabilities": { "mcp": { "servers": ["duckduckgo", "time"], "tool_search": true } } }
```

- Picking nothing means `["openai_docs"]` — byte-identical to the tool payload
  the workbench sent before the picker existed.
- `tool_search: true` adds the `tool_search` tool, so the model searches the
  connected servers' tools and loads what it needs instead of carrying every
  schema up front (the memory capability already declares this tool; sessions
  get exactly one).
- Unknown labels are a 400 on `/api/chat`, but are dropped silently when
  rehydrating a chat record or archive — retiring a server must not make old
  chats unreadable.
- Tools bind at session creation, so the selection is frozen from the first
  turn. The FE locks the picker on `agent_locked`, and forks inherit the
  parent's servers.

## Architecture notes

- One persistent asyncio loop thread owns every async object (SDK clients,
  `AsyncSandbox`, command handles); Flask handlers submit coroutines with
  `run_coroutine_threadsafe`. This keeps httpx clients and handles on a single
  event loop across turns — per-request `asyncio.run` would orphan them.
- `sandbox.kill()` reaps the background executor, so reset/teardown is one call.
- Executor crash detection: launch gates on the exec-server's rendezvous
  confirmation (an immediate crash yields zero session events) + per-event
  `exit_code` check + `is_running()` RPC on stalls.
- Event streams are live and do not replay history. After EOF or a transport
  error, the backend opens a new subscription before reading session state,
  durable turn status, and retained items. Buffered text is reconciled by item
  ID, tool handlers remain attached, and the prompt is submitted only once.
  Recovery is bounded to three reconnects; transport diagnostics, including
  request IDs, appear in runtime logs.
- After 45 seconds without an event, the backend checks the durable turn
  result. Completed, failed, and cancelled turns stay distinct; session idle
  alone never means success. Complete text events repair missed deltas, and
  normal completion does not wait for redundant status polling. See the
  [streaming contract](../../docs/openai-agents-api/32-api-reference.md#stream-session-events).
- The app binds `127.0.0.1` by default and, with no control token configured,
  has no auth beyond the demo client-ID header; don't expose it on the
  network. The E2B template flips both: `HOST=0.0.0.0` plus a generated
  control token, because the sandbox's `:8000` proxy URL is public.

## Files

- `app.py` — the whole backend (JSON/SSE API)
- `mcp_servers.py` — the selectable MCP servers and the tool payloads they
  build
- `auth.py` — control/launch tokens and the session cookie; also a CLI
  (`python auth.py`) that prints a one-click launch URL
- `vendor/agent_api_sdk/` — vendored Agents API preview SDK snapshot
  @ `bdb3190` (see [`vendor/README.md`](vendor/README.md))
- `env.py` — loads `.env` and puts `vendor/` on `sys.path`
