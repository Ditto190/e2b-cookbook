// Live discovery and substantive calls for the four default MCPs.
import { readFileSync } from 'node:fs'
import { Sandbox } from 'e2b'
import { config } from 'dotenv'
import { join } from 'node:path'
config({ path: join(import.meta.dirname, '../../apps/backend/.env'), quiet: true })
const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE_NAME || 'e2b/openai-agents-api-executor', { timeoutMs: 300_000 })
console.log('Check sandbox:', sandbox.sandboxId)
try {
  const repair = readFileSync(join(import.meta.dirname, '../../apps/backend/mcp_gateway_compat.py'), 'utf8')
  await sandbox.files.write('/tmp/mcp_gateway_compat.py', repair)
  await sandbox.commands.run('python3 /tmp/mcp_gateway_compat.py', { user: 'root' })
  const result = await sandbox.commands.run(`mcp-gateway --config '{"hackernews":{},"context7":{},"deepwiki":{}}'`, {
    user: 'root', timeoutMs: 120_000, envs: { GATEWAY_ACCESS_TOKEN: 'catalog-check-token' },
  })
  console.log('Gateway startup:', result.exitCode, result.stdout, result.stderr)

  const tools = await sandbox.commands.run(`python3 - <<'PY'
import urllib.request, json
url='http://127.0.0.1:50005/mcp'
headers={'Authorization':'Bearer catalog-check-token','Content-Type':'application/json','Accept':'application/json, text/event-stream'}
def request(payload):
    response=urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers), timeout=60)
    session=response.headers.get('Mcp-Session-Id')
    if session: headers['Mcp-Session-Id']=session
    return response.read().decode()
print(request({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'catalog-check','version':'1'}}}))
request({'jsonrpc':'2.0','method':'notifications/initialized'})
result=request({'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}})
for line in result.splitlines():
    if line.startswith('data: '): result=line[6:]; break
payload=json.loads(result)
names=[t['name'] for t in payload['result']['tools']]
for prefix in ('context7-', 'deepwiki-', 'mcp-hackernews-'):
    assert any(name.startswith(prefix) for name in names), 'Missing tools for '+prefix
print(json.dumps({'tools':names}), flush=True)
def parsed(payload):
    raw=request(payload)
    for line in raw.splitlines():
        if line.startswith('data: '):
            return json.loads(line[6:])
    return json.loads(raw)
failures=[]
def call(name, args, call_id):
    try:
        result=parsed({'jsonrpc':'2.0','id':call_id,'method':'tools/call',
                       'params':{'name':name,'arguments':args}})
        assert 'error' not in result, result.get('error')
        assert not result['result'].get('isError'), result['result']
        content=result['result'].get('content', [])
        assert content, 'No content returned'
        combined=' '.join(block.get('text','') for block in content)
        if name == 'context7-resolve-library-id':
            assert 'Context7-compatible library ID:' in combined, combined
        print(json.dumps({'tool':name,'status':'PASS','evidence':content})[:1800], flush=True)
    except Exception as error:
        failures.append(name)
        print(json.dumps({'tool':name,'status':'FAIL','error':str(error)[:1000]}), flush=True)
call('mcp-hackernews-get_stories', {'story_type':'top','num_stories':1}, 3)
call('context7-resolve-library-id', {'libraryName':'Next.js','query':'Next.js route handlers'}, 4)
call('deepwiki-read_wiki_structure', {'repoName':'vercel/next.js'}, 5)
url='https://developers.openai.com/mcp'
headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
parsed({'jsonrpc':'2.0','id':6,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'catalog-check','version':'1'}}})
request({'jsonrpc':'2.0','method':'notifications/initialized'})
docs=parsed({'jsonrpc':'2.0','id':7,'method':'tools/list','params':{}})
print(json.dumps({'openai_docs_tools':[t['name'] for t in docs['result']['tools']]}), flush=True)
call('search_openai_docs', {'query':'Responses API function calling','limit':1}, 8)
assert not failures, 'Failed MCP calls: '+', '.join(failures)

PY`, { timeoutMs: 240_000 })
  console.log(tools.stdout)
} finally {
  await sandbox.kill()
  console.log('Check sandbox killed')
}
