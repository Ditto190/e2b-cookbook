# OPENAI & E2B - Agents API Python SDK — template

E2B template that runs this whole repo inside one sandbox: the Flask backend
(`apps/backend/app.py`) serves the built React frontend (`apps/web/dist`) on
port `8000`. Each chat then creates its own inner E2B sandbox running
`codex exec-server` — the workbench sandbox is the host, agent work happens in
the per-chat sandboxes.

## Two templates

| Alias | Role | Build |
| --- | --- | --- |
| `e2b/openai-agents-api-python-sdk` | the workbench: backend + UI in one sandbox, spawns one executor sandbox per chat | `npx tsx template/build.ts` |
| `e2b/openai-agents-api-python-sdk-executor` | one worker per chat: `codex exec-server` baked in, no start command | `npx tsx template/executor/build.ts`, see [executor/README.md](executor/README.md) |

The rest of this file covers the workbench template.

Override aliases per build with `E2B_TEMPLATE_NAME` (and `E2B_EXECUTOR_TEMPLATE`
for the workbench); `verify` and `verify:executor` read the same variables.

## Build

```sh
pnpm install               # workspace root — installs template deps too
npx tsx template/build.ts  # builds apps/web on the host, then the image
```

The frontend is built on the host and shipped as static `dist/` — the image
has no Node at all (the base image's Node 20.9 predates Vite 7's floor, and
Flask serves the static build at runtime anyway). The image installs only
`uv` and the backend venv (`uv sync --frozen`, Debian 12's Python 3.11).

`E2B_API_KEY` is loaded from `apps/backend/.env`; the template lands in that
key's team — export `E2B_API_KEY` before running to target a different org
(env wins over `.env`). Alias:
`openai-agents-api-python-sdk` (public as `e2b/openai-agents-api-python-sdk`;
E2B aliases don't allow spaces or `&`). Override per build with
`E2B_TEMPLATE_NAME` / `E2B_BUILD_TAG`.

## Try it

1. Create a sandbox from the template — the sandbox terminal prints an
   **OPEN THE DEMO** link
   (`https://8000-<sandbox-id>.e2b.app/#token=…`). The `:8000` proxy URL is
   public, so `start.sh` generates a per-sandbox control token and the link
   carries a single-use, 10-minute launch token the frontend redeems for a
   session cookie and strips from the address bar. `demo-url` mints a fresh
   link; `demo-token` prints the reusable control token. To share with a
   second person, use the invite button in the app header (single-use link)
   or hand over the control token — see the root README's Access control
   section for what is and is not isolated.
2. The key gate opens on load: paste your E2B API key and a scoped OpenAI
   project key (Agents API preview access). The backend holds both in process
   memory only — nothing is baked into the image or written to disk. The gate
   is dismissible, but chats won't run without keys.
3. Chat; watch activity and `/workspace` files of the inner sandbox in the
   right-hand viewer.

## Image layout

- `/opt/workbench` — this repo (frontend prebuilt to `apps/web/dist`,
  backend venv at `apps/backend/.venv`, node_modules stripped after build)
- `/usr/local/bin/agents-api-workbench` — start command (`template/start.sh`)
- `/home/user/.bash_aliases` — terminal welcome banner + `demo-url` /
  `demo-token`
- `/home/user/.config/agents-api-workbench/` — control token and pending
  single-use launch tokens (mode 0700, owned by `user`; created at boot)

New chats select Hacker News, Context7, DeepWiki, and OpenAI Docs by default,
with tool search enabled. The first three use the E2B MCP gateway; OpenAI Docs
uses its hosted endpoint. Explicit MCP tests are instructed to call the named
servers and report real results or errors, without substituting web search.
