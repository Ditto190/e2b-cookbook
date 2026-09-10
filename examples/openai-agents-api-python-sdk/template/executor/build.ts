// E2B template build for the Agents API executor sandbox: codex exec-server
// baked in, nothing else. One of these runs per chat; the workbench backend
// (apps/backend/app.py, E2B_AGENTS_TEMPLATE) starts it and runs
//   codex exec-server --remote https://api.openai.com/v1/agents/api --environment-id <id>
// inside. No start command: the executor is launched session-bound by whoever
// provisions the sandbox, with CODEX_API_KEY supplied at that moment.
//
// Run from anywhere:
//   pnpm install                     (workspace root, template deps included)
//   npx tsx template/executor/build.ts
//
// No credentials are baked in.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { Template, defaultBuildLogger, type McpServerName } from 'e2b'

declare const process: {
  env: Record<string, string | undefined>
}

const REPO_ROOT = join(import.meta.dirname, '..', '..')

// E2B_API_KEY comes from the backend .env, the project's single key source.
config({
  path: [join(REPO_ROOT, 'apps/backend/.env')],
  quiet: true,
})

// Public template under the E2B org (e2b/openai-agents-api-executor).
const TEMPLATE_NAME =
  process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-executor'
// Same pin as the workbench template (template/build.ts): the version the
// backend is known to work against.
const CODEX_VERSION = '0.145.0-alpha.24'
const tag = process.env.E2B_BUILD_TAG || undefined

// E2B's hosted MCP catalog — the same ids the backend picker offers under the
// `gateway` origin (apps/backend/mcp_servers.py reads this file too).
// addMcpServer() caches each server's image at build time; the coordinator
// then starts only the ones a chat picked. Requires the mcp-gateway base.
// Only `server`-type catalog entries can be prepulled: a remote-type id
// (context7, deepwiki, gitmcp, llmtxt) fails the build with
// `is type "remote"; expected "server"`. All four here are also keyless.
const mcpCatalog = JSON.parse(readFileSync(
  join(import.meta.dirname, 'mcp-catalog.json'), 'utf8'
)) as { id: McpServerName }[]

export const template = Template({ fileContextPath: REPO_ROOT })
  // mcp-gateway, not the plain base image: addMcpServer() throws on any other
  // base, and the gateway binary is what serves the catalog on loopback.
  .fromTemplate('mcp-gateway')
  .addMcpServer(mcpCatalog.map((server) => server.id))
  .copy('apps/backend/mcp_gateway_compat.py', '/tmp/mcp_gateway_compat.py', { user: 'root' })
  .runCmd('python3 /tmp/mcp_gateway_compat.py && rm /tmp/mcp_gateway_compat.py', { user: 'root' })
  // What the agent needs to do real work in /workspace: git, python, rg
  // (codex's search backend), file/pdf inspection like the upstream Docker
  // executor image.
  .aptInstall([
    'ca-certificates',
    'curl',
    'file',
    'git',
    'poppler-utils',
    'python3',
    'python3-pip',
    'ripgrep',
  ])
  .runCmd([
    `sudo npm install --global @openai/codex@${CODEX_VERSION}`,
    'sudo mkdir -p /workspace /codex-home',
    'sudo chown -R user:user /workspace /codex-home',
    'codex exec-server --help >/dev/null',
  ])
  .setEnvs({ CODEX_HOME: '/codex-home' })
  .setWorkdir('/workspace')

const build = await Template.build(template, tag ? `${TEMPLATE_NAME}:${tag}` : TEMPLATE_NAME, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
})

console.log('Built template:', JSON.stringify(build))
