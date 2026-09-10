// Spawn one sandbox from the freshly built executor template and verify the
// baked runtime: codex on PATH, exec-server subcommand present, /workspace
// and /codex-home owned by `user`, no start command running.
import { Sandbox } from 'e2b'
import { config } from 'dotenv'
import { join } from 'node:path'
import assert from 'node:assert/strict'

config({ path: join(import.meta.dirname, '..', '..', 'apps/backend/.env'), quiet: true })

const TEMPLATE =
  process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-executor'

const sbx = await Sandbox.create(TEMPLATE, { timeoutMs: 120_000 })
console.log('sandbox:', sbx.sandboxId)

try {
  const version = await sbx.commands.run('codex --version')
  assert.ok(version.stdout.includes('0.145.0-alpha.24'))
  console.log('codex:', version.stdout.trim())

  const help = await sbx.commands.run('codex exec-server --help >/dev/null && echo ok')
  console.log('exec-server subcommand:', help.stdout.trim())

  const dirs = await sbx.commands.run('stat -c "%U %n" /workspace /codex-home && echo "CODEX_HOME=$CODEX_HOME" && pwd')
  console.log('layout:\n' + dirs.stdout.trim())

  const tools = await sbx.commands.run('command -v rg git python3 flock | tr "\\n" " "')
  console.log('tools:', tools.stdout.trim())

  const procs = await sbx.commands.run('pgrep -fc "[c]odex exec-server" || true')
  assert.equal(procs.stdout.trim(), '0')
  console.log('exec-server processes before launch (expect 0):', procs.stdout.trim())
  await sbx.commands.run('command -v mcp-gateway >/dev/null && test -w /workspace && test -w /codex-home')
  console.log('MCP gateway and writable runtime directories: passed')
  await sbx.commands.run(`python3 - <<'PY'
from pathlib import Path
import re
catalog = Path('/etc/mcp-gateway/docker-catalog.yaml').read_text()
deepwiki = re.search(r'(?ms)^  deepwiki:\\n.*?(?=^  \\S|\\Z)', catalog).group()
context7 = re.search(r'(?ms)^  context7:\\n.*?(?=^  \\S|\\Z)', catalog).group()
assert 'https://mcp.deepwiki.com/mcp' in deepwiki
assert 'transport_type: streamable-http' in deepwiki
assert 'CONTEXT7_API_KEY: "\${CONTEXT7_API_KEY}"' not in context7
PY`, { user: 'root' })
  console.log('DeepWiki transport and anonymous Context7 catalog: passed')
} finally {
  await sbx.kill()
  console.log('sandbox killed')
}
