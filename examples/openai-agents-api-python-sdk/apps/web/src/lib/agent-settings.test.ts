import { beforeEach, expect, it, vi } from 'vitest'

const key = 'agents-api-workbench-agent-settings:v2'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

it('uses server defaults and tool search for a fresh draft', async () => {
  const { agentRequestFields } = await import('./agent-settings')
  expect(agentRequestFields().capabilities.mcp).toEqual({ tool_search: true })
})

it('migrates old MCP defaults while preserving model tuning', async () => {
  localStorage.setItem(key, JSON.stringify({
    model: 'gpt-5.6-luna', reasoningEffort: 'high', serviceTier: 'priority',
    capabilities: { mcp: { servers: ['openai_docs'], tool_search: false } },
  }))
  const { agentRequestFields } = await import('./agent-settings')
  expect(agentRequestFields()).toMatchObject({
    model: 'gpt-5.6-luna', reasoning_effort: 'high', service_tier: 'priority',
    capabilities: { mcp: { tool_search: true } },
  })
  expect(agentRequestFields().capabilities.mcp?.servers).toBeUndefined()
})

it('retains a new explicit selection and disabled search across reloads without credentials', async () => {
  const { setAgentSettings } = await import('./agent-settings')
  setAgentSettings({ capabilities: { mcp: {
    servers: ['exa'], tool_search: false, options: { exa: { apiKey: 'private-test-key' } },
  } } })
  expect(localStorage.getItem(key)).not.toContain('private-test-key')
  vi.resetModules()
  const { agentRequestFields } = await import('./agent-settings')
  expect(agentRequestFields().capabilities.mcp).toEqual({ servers: ['exa'], tool_search: false })
})
