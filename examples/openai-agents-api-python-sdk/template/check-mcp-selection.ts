// Live check: save MCP changes during startup, then use a newly added MCP.
import assert from 'node:assert/strict'
import { Sandbox } from 'e2b'
import { config } from 'dotenv'
import { join } from 'node:path'
config({ path: join(import.meta.dirname, '../apps/backend/.env'), quiet: true, override: true })
const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-python-sdk', { timeoutMs: 360_000 })
const base = `https://${sandbox.getHost(8000)}`
const chatId = 'mcp-selection-live-check'
let headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Demo-Client-ID': 'mcp-live-check' }
async function post(path: string, body: object) {
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })
  assert.ok(response.ok, `${path}: HTTP ${response.status}`)
  return response
}
try {
  const token = (await sandbox.commands.run('cat /home/user/.config/agents-api-workbench/control-token')).stdout.trim()
  const login = await post('/api/auth/login', { token })
  headers = { ...headers, cookie: (login.headers.get('set-cookie') || '').split(';')[0] }
  await post('/api/keys', { e2b_api_key: process.env.E2B_API_KEY, openai_api_key: process.env.OPENAI_API_KEY, openai_executor_api_key: process.env.OPENAI_EXECUTOR_API_KEY })
  const chat = await post('/api/chat', { chat_id: chatId, client_id: 'mcp-live-check', prompt: 'Say ready. Do not call any tools or delegate.', capabilities: { delegation: { enabled: false }, memory: { enabled: process.env.MCP_CHECK_MEMORY !== 'false' } } })
  const finished = chat.text().then(text => {
    const errors = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).filter(e => e.type === 'error')
    if (errors.length) console.log('Turn errors:', JSON.stringify(errors))
    return text
  })
  for (const servers of [['hackernews'], ['hackernews', 'time']]) {
    const response = await post('/api/mcp/selection', { chat_id: chatId, client_id: 'mcp-live-check', mcp: { servers, tool_search: true } })
    assert.equal(response.status, 202)
    const snapshot = await response.json()
    assert.deepEqual([...snapshot.pending_mcp.servers].sort(), [...servers].sort())
    console.log('Saved during active turn:', servers.join(', '))
  }
  const events = (await finished).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
  assert.ok(!events.some(e => e.type === 'error'), JSON.stringify(events.filter(e => e.type === 'error')))
  const done = events.find(e => e.type === 'done')
  assert.ok(done?.session?.sandbox)
  let status
  const deadline = Date.now() + 180_000
  do {
    status = await (await fetch(base + '/api/status?chat_id=' + chatId, { headers })).json()
    if (!status.pending_mcp) break
    assert.ok(Date.now() < deadline, 'MCP update timed out')
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (true)
  assert.equal(status.mcp_update_error, null)
  assert.deepEqual([...status.capabilities.mcp.servers].sort(), ['hackernews', 'time'])
  assert.equal(status.sandbox, done.session.sandbox)
  assert.notEqual(status.session_id, done.session.session_id)
  console.log('Latest selection applied; same sandbox, replacement session')
  const next = await post('/api/chat', { chat_id: chatId, client_id: 'mcp-live-check', prompt: 'Use the Time MCP to get the current time in UTC. Make an actual Time tool call. No web, shell, HTTP, or delegation. Briefly report the result.' })
  const nextEvents = (await next.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
  assert.ok(!nextEvents.some(e => e.type === 'error'), JSON.stringify(nextEvents.filter(e => e.type === 'error')))
  const calls = nextEvents.filter(e => e.type === 'activity' && /Used time\./.test(e.label))
  assert.ok(calls.length, 'Newly added Time MCP was not called')
  console.log('Newly added MCP called:', calls.map(e => e.label).join(', '))
} finally {
  try { await post('/api/reset', { chat_id: chatId, client_id: 'mcp-live-check' }) } finally { await sandbox.kill() }
  console.log('Test chat and sandbox cleaned up')
}
