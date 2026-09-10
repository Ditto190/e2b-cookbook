// E2B template build for the Agents API Python SDK workbench — the whole
// monorepo (Flask backend + built React frontend) running inside one sandbox
// on port 8000.
//
// Run from anywhere:
//   pnpm install            (workspace root — template deps included)
//   npx tsx template/build.ts
//
// No credentials are baked in: the UI key gate collects E2B + OpenAI keys at
// runtime and the backend holds them in process memory only.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { config } from 'dotenv'
import { Template, defaultBuildLogger, waitForPort } from 'e2b'

declare const process: {
  env: Record<string, string | undefined>
}

// SDK gotcha: fileContextPath defaults to THIS FILE's directory (template/),
// not the cwd — anchor everything to the repo root explicitly.
const REPO_ROOT = join(import.meta.dirname, '..')

// Keys come from the backend .env — the project's single key source.
config({
  path: [join(REPO_ROOT, 'apps/backend/.env')],
  quiet: true,
})

// Public template under the E2B org (e2b/openai-agents-api-python-sdk).
// E2B aliases don't allow spaces/& — display name lives in the dashboard.
const TEMPLATE_NAME =
  process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-python-sdk'
const EXECUTOR_TEMPLATE =
  process.env.E2B_EXECUTOR_TEMPLATE || 'e2b/openai-agents-api-python-sdk-executor'
// Executors normally come from template/executor; codex stays baked in here
// so E2B_AGENTS_TEMPLATE can still point the backend at this image. Keep the
// pin in sync with template/executor/build.ts.
const CODEX_VERSION = '0.145.0-alpha.24'
const tag = process.env.E2B_BUILD_TAG || undefined

const APP = '/opt/workbench'

// Build the frontend HERE, on the host, and ship the static dist/ — the E2B
// base image's Node (20.9) is too old for Vite 7, and the image doesn't need
// Node at runtime anyway (Flask serves dist/).
console.log('Building apps/web…')
execFileSync('pnpm', ['--filter', 'web', 'build'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
})

export const template = Template({
  fileContextPath: REPO_ROOT,
  fileIgnorePatterns: [
    '**/node_modules/**',
    '**/.venv/**',
    '**/__pycache__/**',
    '**/*.pyc',
    '**/.git/**',
    '**/chats-state.json',
    '**/chat-history/**',
    '**/shared-memory.json',
    '**/.env.*',
    '**/.env',
    '**/.env.local',
  ],
})
  .fromBaseImage()
  .aptInstall(['ca-certificates', 'curl', 'git', 'python3', 'python3-pip'])
  .copy('apps/backend', `${APP}/apps/backend`, { user: 'root' })
  .copy('apps/web/dist', `${APP}/apps/web/dist`, { user: 'root' })
  .copy('template/start.sh', `${APP}/template/start.sh`, { user: 'root' })
  .copy('template/terminal-welcome.sh', `${APP}/template/terminal-welcome.sh`, { user: 'root' })
  .copy('template/executor/mcp-catalog.json', `${APP}/template/executor/mcp-catalog.json`, { user: 'root' })
  .runCmd([
    `sudo chown -R user:user ${APP}`,
    // Executor runtime: codex exec-server + the directories the backend
    // expects when it launches executors from this template.
    `sudo npm install --global @openai/codex@${CODEX_VERSION}`,
    'sudo mkdir -p /workspace /codex-home',
    'sudo chown -R user:user /workspace /codex-home',
    'codex exec-server --help >/dev/null',
    'sudo python3 -m pip install --break-system-packages --no-cache-dir uv',
    // Debian 12 python3 is 3.11 — meets the backend's >=3.11; uv would fetch
    // a managed CPython otherwise.
    `cd ${APP}/apps/backend && uv sync --frozen`,
    `test -f ${APP}/apps/web/dist/index.html`,
    // backend import smoke test (same as the repo's own typecheck script)
    `cd ${APP}/apps/backend && .venv/bin/python -c 'import app'`,
    // launcher + terminal welcome banner (demo-url helper)
    `sudo cp ${APP}/template/start.sh /usr/local/bin/agents-api-workbench`,
    'sudo chmod 0755 /usr/local/bin/agents-api-workbench',
    `sudo cp ${APP}/template/terminal-welcome.sh /home/user/.bash_aliases`,
    'sudo chown user:user /home/user/.bash_aliases',
  ])
  .setEnvs({ E2B_AGENTS_TEMPLATE: EXECUTOR_TEMPLATE })
  .setWorkdir('/home/user')
  .setStartCmd('agents-api-workbench', waitForPort(8000))

const build = await Template.build(template, tag ? `${TEMPLATE_NAME}:${tag}` : TEMPLATE_NAME, {
  // Beefy on purpose: the workbench sandbox also spawns nested executor
  // sandboxes' workloads through the agent, and demos die on OOM, not CPU.
  cpuCount: 4,
  memoryMB: 8192,
  onBuildLogs: defaultBuildLogger(),
})

console.log('Built template:', JSON.stringify(build))
