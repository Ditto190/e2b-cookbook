# OPENAI & E2B - Agents API executor sandbox

E2B template for the per-chat **executor** sandbox: `codex exec-server` is
baked in at a pinned version, `/workspace` and `/codex-home` exist and belong
to `user`, and there is no start command. One executor sandbox serves one
Agents API session; the workbench backend (`apps/backend/app.py`,
`E2B_AGENTS_TEMPLATE`) launches the executor inside it with the session's
environment id:

```sh
CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" \
codex exec-server \
  --remote https://api.openai.com/v1/agents/api \
  --environment-id "$ENVIRONMENT_ID"
```

The executor dials **out** to OpenAI; nothing listens on an inbound port.

## Build

```sh
pnpm install                        # workspace root
npx tsx template/executor/build.ts  # or: pnpm --filter agents-api-workbench-template build:executor
npx tsx template/executor/verify.ts # spawns one sandbox, checks the runtime, kills it
```

`E2B_API_KEY` is loaded from `apps/backend/.env` (env wins over `.env`).
Alias: `openai-agents-api-python-sdk-executor` (public as
`e2b/openai-agents-api-python-sdk-executor`). Override per build with
`E2B_TEMPLATE_NAME` / `E2B_BUILD_TAG`.

## Why a separate image

The upstream E2B example starts a default sandbox and runs
`npm install -g @openai/codex@alpha` on every fresh worker. This template moves
that install into the image: executors boot with codex already present and
pinned, so a chat's first turn does not pay for an npm install and every
executor runs the same CLI version. It also runs at half the CPU and memory of the
workbench image, which no longer needs to double as the executor.

## Image layout

- `/usr/local/bin/codex` (npm global) at `CODEX_VERSION` from `build.ts`
- `/workspace` (workdir) and `/codex-home` (`CODEX_HOME`), owned by `user`
- `git`, `python3`, `ripgrep`, `file`, `poppler-utils` for agent work

## E2B MCP catalog

The image derives from the `mcp-gateway` base and calls
[`addMcpServer()`](https://docs.e2b.dev/sdk-reference/js-sdk/v2.38.2/template#addmcpserver)
with the ids in `mcp-catalog.json` (Fetch, Hacker News, Markdownify,
Sequential Thinking — all keyless), caching their images at build time. That
file is the *prepull* list, not the picker's catalog: the backend offers every
server the SDK knows and the gateway pulls the rest on first use, so adding an
id here only makes it start instantly. Only `server`-type catalog entries can
be prepulled; a remote-type id (context7, deepwiki, gitmcp, llmtxt) fails the
build. Context7 and DeepWiki are proxied at runtime by the gateway, and are
pinned alongside Hacker News in the picker. Nothing is started by the
build: the coordinator runs `mcp-gateway --config` for a chat's picked servers
before launching exec-server, and the agent reaches them over sandbox loopback
at `http://127.0.0.1:50005/mcp` behind a per-chat bearer token. A pinned
`mcp-proxy` process bridges that HTTP connection to executor stdio, avoiding
the executor's failing direct HTTP/SSE handshake. The bridge is fetched by
`uvx` on first use and inherits its token from the executor environment. The picker's
other servers do not touch the gateway: `openai_docs` is dialled by OpenAI's
service, and DuckDuckGo/Wikipedia/Time are stdio subprocesses launched with
`uvx`. See `apps/backend/README.md` for the selection contract.

Run `pnpm --filter agents-api-workbench-template exec tsx executor/check-catalog.ts`
to verify that Hacker News, Context7, and DeepWiki advertise tools through the
gateway. The backend repairs DeepWiki's retired SSE endpoint in older gateway
catalogs before startup, so existing executor sandboxes work too.
