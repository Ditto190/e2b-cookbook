// Spawn one sandbox from the freshly built template and verify:
// UI served, control-token gate closed, login with the token opens it,
// health flags, key-gate POST flips flags, welcome banner + demo-url.
import { Sandbox } from 'e2b'
import { config } from 'dotenv'
import { join } from 'node:path'
import assert from 'node:assert/strict'

config({ path: join(import.meta.dirname, '..', 'apps/backend/.env'), quiet: true })

const TEMPLATE = process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-python-sdk'

const sbx = await Sandbox.create(TEMPLATE, { timeoutMs: 300_000 })
console.log('sandbox:', sbx.sandboxId)
const base = `https://${sbx.getHost(8000)}`
console.log('url:', base)

try {
  const health = await (await fetch(`${base}/api/health`)).json()
  console.log('health:', JSON.stringify(health))
  assert.equal(health.has_e2b_key, false)
  assert.equal(health.has_openai_key, false)
  assert.equal(health.auth_required, true)

  const index = await (await fetch(`${base}/`)).text()
  assert.ok(index.includes('root'))
  console.log('index served:', index.includes('<div id="root">') || index.includes('root'))
  console.log('index head:', index.slice(0, 120).replace(/\n/g, ' '))

  const spa = await fetch(`${base}/some/deep/route`)
  console.log('spa fallback:', spa.status, (await spa.text()).includes('root'))

  // The proxy URL is public, so every /api route but the boot probe and the
  // login handshake must refuse an anonymous caller.
  const locked = await fetch(`${base}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openai_api_key: 'sk-should-not-land' }),
  })
  assert.equal(locked.status, 401)
  console.log('keys without a session:', locked.status, await locked.text())

  const token = (
    await sbx.commands.run('cat /home/user/.config/agents-api-workbench/control-token')
  ).stdout.trim()
  assert.ok(token.length > 0)
  console.log('control token present:', token.length > 0)

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  // Node's fetch drops cookies; carry the Set-Cookie value by hand.
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
  console.log('login:', login.status, JSON.stringify(await login.json()))

  assert.equal(login.status, 200)
  assert.ok(cookie)

  const authed = { 'Content-Type': 'application/json', cookie }
  const keys = await (
    await fetch(`${base}/api/keys`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ e2b_api_key: 'e2b_dummy_verify', openai_api_key: 'sk-dummy-verify' }),
    })
  ).json()
  console.log('after key post:', JSON.stringify(keys))
  assert.equal(keys.has_e2b_key, true)
  assert.equal(keys.has_openai_key, true)

  const catalog = await (await fetch(`${base}/api/mcp/servers`, { headers: authed })).json()
  assert.ok(catalog.servers.length > 200)
  assert.deepEqual(catalog.default, ['hackernews', 'context7', 'deepwiki', 'openai_docs'])
  for (const label of ['hackernews', 'context7', 'deepwiki']) {
    assert.equal(catalog.servers.find((server: { label: string }) => server.label === label)?.connection_origin, 'gateway')
  }
  const credentials = await fetch(`${base}/api/mcp/credentials`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ server: 'exa', options: { apiKey: 'dummy-mcp-verify' } }),
  })
  assert.equal(credentials.status, 200)
  assert.deepEqual(await credentials.json(), { options: { exa: { apiKey: '•' } } })
  const configured = await (await fetch(`${base}/api/mcp/credentials`, { headers: authed })).json()
  assert.deepEqual(configured.options.exa, { apiKey: '•' })
  const selection = await fetch(`${base}/api/mcp/selection`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ chat_id: 'verify-chat', client_id: 'verify-client', mcp: { servers: ['exa'] } }),
  })
  assert.equal(selection.status, 404)
  console.log('MCP catalog, credential saving, masking and selection endpoint: passed')

  // Command sessions do not inherit the template start process's ENV.
  // Read that process's executor setting, then check the Python defaults.
  const runtime = await sbx.commands.run(`cd /opt/workbench/apps/backend && .venv/bin/python - <<'PY'
from pathlib import Path
import app
assert app.McpCapability().tool_search is True
for path in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        command = path.read_bytes().split(b'\\0')
        if len(command) > 1 and command[1] == b'app.py':
            environment = dict(entry.split(b'=', 1) for entry in (path.parent / 'environ').read_bytes().split(b'\\0') if b'=' in entry)
            print(environment.get(b'E2B_AGENTS_TEMPLATE', app.E2B_TEMPLATE.encode()).decode())
            break
    except (PermissionError, FileNotFoundError, ProcessLookupError):
        continue
else:
    raise AssertionError('Running backend process not found')
PY`, { user: 'root' })
  assert.equal(runtime.stdout.trim(), process.env.E2B_EXECUTOR_TEMPLATE || 'e2b/openai-agents-api-python-sdk-executor')
  await sbx.commands.run('test ! -f /opt/workbench/apps/backend/.env && test ! -f /opt/workbench/apps/backend/chats-state.json && test ! -f /opt/workbench/apps/backend/shared-memory.json')
  console.log('Executor default and clean template filesystem: passed')

  const invite = await (
    await fetch(`${base}/api/auth/invite`, { method: 'POST', headers: authed })
  ).json()
  console.log('invite url minted:', String(invite.url).includes('#token='))

  // Single use: the launch token in that URL must not work twice.
  const launchToken = String(invite.url).split('#token=')[1]
  const first = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  })
  const replay = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  })
  assert.equal(first.status, 200)
  assert.equal(replay.status, 401)
  console.log('launch token redeem/replay:', first.status, replay.status)

  const banner = await sbx.commands.run(
    'cat /home/user/.bash_aliases | head -3 && bash -c \'source /home/user/.bash_aliases; demo-url\''
  )
  assert.ok(banner.stdout.includes('#token='))
  console.log('banner and demo-url: passed')

  const ps = await sbx.commands.run('ps aux | grep -c "[a]pp.py"')
  console.log('app.py processes:', ps.stdout.trim())
} finally {
  await sbx.kill()
  console.log('sandbox killed')
}
