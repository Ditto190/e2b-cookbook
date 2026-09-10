# OpenAI Agents API workbench

A full-stack workbench for the OpenAI Agents API: a Flask backend that
orchestrates [E2B](https://e2b.dev) sandboxes (each chat gets its own sandbox
running the agent), paired with a typed React frontend. The only contract
between the two is [openapi/openapi.yaml](openapi/openapi.yaml) — the frontend
compiles exclusively against types generated from that spec.

The backend originates from Matthew Brockman's Agents API workbench; the
React frontend replaces its vanilla `static/` UI.

## Layout

```
apps/backend   Flask app orchestrating Agents API sessions + E2B sandboxes (uv-managed)
apps/web       Vite + React 19 + TanStack Router/Query + Tailwind 4
openapi/       OpenAPI 3.1 spec — the BE↔FE contract
template/      E2B template: the whole app running inside one sandbox on :8000
scripts/       Dev entry point (scripts/dev.sh, wired to `pnpm dev`)
```

## Quickstart

```sh
pnpm install   # also uv-syncs the backend venv (postinstall)
pnpm dev       # Flask on :8000, Vite on :3000 (proxies /api → :8000)
```

Open http://localhost:3000. The first prompt creates an Agents API session
plus an E2B sandbox and streams the turn (activity timeline + output text);
the right pane lists `/workspace` with click-to-preview.

Run `pnpm test` for the Python and frontend tests, `pnpm typecheck` for import
and TypeScript checks, and `pnpm cleanup` for dependency and dead-code checks.
Tests use an HTTP test transport for interrupted Agents API streams and do
not create sandboxes or call OpenAI.

## Environment keys

The app needs two keys, plus an optional third:

- `E2B_API_KEY` — an [E2B](https://e2b.dev/dashboard) API key
- `OPENAI_API_KEY` — **dispatcher** key, with Agents API access. Used by the
  backend process only: creating and driving sessions, listing models. It
  never leaves this process.
- `OPENAI_EXECUTOR_API_KEY` — **executor** key, optional. The only credential
  that enters a sandbox (as `CODEX_API_KEY` for `codex exec-server`), where
  agent-authored code can read it out of the environment. Scope it down in the
  OpenAI dashboard; it must live in the same OpenAI project as the dispatcher
  key, because exec-server registers against the environment the dispatcher
  created. Unset means the executor reuses `OPENAI_API_KEY`.

Set them in `apps/backend/.env` (`env.py` loads `.env`); see
[apps/backend/.env.example](apps/backend/.env.example) for the layout. Without keys the app still boots
and the UI opens a key gate that accepts them at runtime — they are held in
backend process memory only, never written to disk.

A chat that pastes its **own** OpenAI key in the key gate uses that key on
both sides: the split only applies to chats running on the host key, since
both keys must belong to one project.

## Access control

A sandbox's port proxy (`https://8000-<id>.e2b.app`) is public, so the
in-sandbox build gates every `/api` route behind a control token
(`apps/backend/auth.py`):

- `template/start.sh` generates a per-sandbox control token at boot into
  `/home/user/.config/agents-api-workbench/control-token`.
- The terminal banner prints a link carrying a **single-use, 10-minute launch
  token** in the URL fragment; the frontend redeems it for a 12-hour
  `HttpOnly; SameSite=Strict` session cookie and strips it from the address
  bar. `demo-url` mints a fresh one, `demo-token` prints the reusable token.
- **Multiple people:** the header's invite button (`POST /api/auth/invite`)
  copies another single-use link. Everyone who redeems one gets their own
  cookie but shares this backend — same keys, same sandboxes, same chats.
  Everyone sees the same chat list and transcripts from the coordinator's
  filesystem, including forks. This workbench provides shared access.
- Rotating the control token invalidates every outstanding session, because it
  is also the cookie's HMAC key.

Locally no control token is configured, so the gate is off and the backend
binds to loopback.

## Contract workflow

`apps/web/src/api/schema.ts` is committed and regenerated from the spec:

```sh
pnpm gen
```

Change a response shape in `apps/backend/app.py` → update `openapi/openapi.yaml`
in the same commit → `pnpm gen` → `pnpm typecheck` surfaces every frontend
call site that no longer matches. SSE events on `/api/chat` are typed as the
`ChatEvent` discriminated union; the reader in `apps/web/src/api/client.ts`
hand-parses SSE frames but yields only that generated type.

## Run inside an E2B sandbox

The [template/](template/README.md) directory builds this app into the public
E2B template `e2b/openai-agents-api-python-sdk`: backend + prebuilt frontend
running in one sandbox on port `8000`, with a terminal welcome banner that
prints the demo link. No credentials are baked into the image — the key gate
collects them at runtime.

Each chat's agent runs in its own sandbox from the sibling template
`e2b/openai-agents-api-python-sdk-executor` (`codex exec-server` baked in, no
start command); see [template/executor/README.md](template/executor/README.md).

## Authors

- Backend — Matthew Brockman & Ondrej Drapalik
- Web — Ondrej Drapalik

Chat transcripts are saved as `apps/backend/chat-history/<chat-id>.json`
(`/opt/workbench/apps/backend/chat-history/` in the coordinator sandbox).
They survive browser changes, backend restarts and coordinator pause/resume;
they last as long as that coordinator filesystem. Existing browser archives
are imported once, without overwriting chats already on the coordinator.
Browser storage keeps only UI preferences and browser/current-chat IDs.

Before each turn, the coordinator copies that chat's transcript to
`/workspace/.workbench/chat.json` in its executor. Forks copy the coordinator
history and receive their own transcript file, including provenance. These
executor files are read snapshots; edits there do not change the shared archive.
Runtime archives are excluded from template builds.

`pnpm build` builds the web app locally. Publishing the coordinator template
is a separate command: `pnpm --filter agents-api-workbench-template build`.
