// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { McpServerInfo, SessionSnapshot } from '@/api/client'
import { setAgentSettings } from '@/lib/agent-settings'
import { AgentControls } from './agent-controls'
import { McpPicker } from './mcp-picker'

const server = (partial: Partial<McpServerInfo> & Pick<McpServerInfo, 'label' | 'name'>): McpServerInfo => ({
  description: `${partial.name} server.`, connection_origin: 'gateway', runs_in_sandbox: true,
  server_url: null, launch: null, options: [], needs_config: false, prepulled: false, ...partial,
})
const catalog = {
  servers: [
    server({ label: 'openai_docs', name: 'OpenAI Docs', connection_origin: 'service', runs_in_sandbox: false }),
    server({ label: 'fetch', name: 'Fetch' }),
    server({ label: 'context7', name: 'Context7' }),
    server({ label: 'deepwiki', name: 'DeepWiki' }),
    server({ label: 'hackernews', name: 'Hacker News' }),
    server({ label: 'exa', name: 'Exa', description: 'Web search built for AI.', needs_config: true,
      options: [{ key: 'apiKey', required: true, description: 'Exa API key.', secret: true },
        { key: 'region', required: true, description: 'Service region.', secret: false }] }),
  ], default: ['openai_docs'],
}
const { saveMcpCredentials, fetchMcpCredentials, setMcpSelection } = vi.hoisted(() => ({
  saveMcpCredentials: vi.fn(), fetchMcpCredentials: vi.fn(), setMcpSelection: vi.fn(),
}))
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  saveMcpCredentials, fetchMcpCredentials, setMcpSelection,
  fetchModels: async () => ({ models: [] }), fetchMcpServers: async () => catalog,
}))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })

function renderPicker(props: Partial<Parameters<typeof McpPicker>[0]> = {}) {
  const onChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><McpPicker mcp={{ tool_search: false }} locked={false} onChange={onChange} {...props} /></QueryClientProvider>)
  return onChange
}
async function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'MCP servers' }))
  await screen.findByRole('button', { name: 'OpenAI Docs' })
  await waitFor(() => expect((screen.getByRole('button', { name: /Save MCPs/ }) as HTMLButtonElement).disabled).toBe(false))
}
const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  fetchMcpCredentials.mockResolvedValue({ options: {} })
  saveMcpCredentials.mockResolvedValue({ options: { exa: { apiKey: '•', region: '•' } } })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); setAgentSettings({ capabilities: { mcp: { tool_search: false } } }) })

it('searches and filters the catalog, committing picks only on Save', async () => {
  const onChange = renderPicker()
  await openPicker()
  expect(screen.getByRole('button', { name: 'OpenAI Docs' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search MCP servers' }), { target: { value: 'built for AI' } })
  expect(screen.getByRole('button', { name: 'Exa' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Fetch' })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search MCP servers' }), { target: { value: '' } })
  pick('Free')
  expect(screen.queryByRole('button', { name: 'Exa' })).toBeNull()
  pick('Fetch')
  expect(onChange).not.toHaveBeenCalled()
  pick('Save MCPs (2)')
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ servers: ['openai_docs', 'fetch'], tool_search: false, options: {} }))
})

it('deselects every pick at once and toggles tool search', async () => {
  const onChange = renderPicker()
  await openPicker()
  expect(screen.getByRole('switch', { name: 'Tool search' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('button', { name: 'About tool search' })).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: 'Tool search' }))
  expect(screen.getByRole('switch', { name: 'Tool search' }).getAttribute('aria-checked')).toBe('true')
  pick('Fetch')
  pick('Deselect all')
  expect(screen.getByRole('button', { name: 'OpenAI Docs' }).getAttribute('aria-pressed')).toBe('false')
  expect((screen.getByRole('button', { name: 'Deselect all' }) as HTMLButtonElement).disabled).toBe(true)
  pick('Save MCPs (0)')
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ servers: [], tool_search: true, options: {} }))
})

it('treats a pick whose credentials are gone as unselected and leaves it out of the save', async () => {
  // Credentials live in backend memory and die with a restart; the pick in
  // localStorage outlives them.
  const onChange = renderPicker({ mcp: { servers: ['openai_docs', 'exa'], tool_search: false } })
  await openPicker()
  expect(screen.getByRole('button', { name: 'Exa' }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText('Not configured, so not selected')).toBeTruthy()
  pick('Save MCPs (1)')
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ servers: ['openai_docs'], tool_search: false, options: {} }))
})

it('uses a dedicated configuration panel, validates all fields, and saves credentials separately', async () => {
  const onChange = renderPicker()
  await openPicker()
  pick('Exa')
  expect(screen.queryByRole('textbox', { name: 'Search MCP servers' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Exa configuration' })).toBeTruthy()
  const key = screen.getByLabelText('apiKey *') as HTMLInputElement
  expect(key.type).toBe('password')
  expect((screen.getByLabelText('region *') as HTMLInputElement).type).toBe('text')
  fireEvent.change(key, { target: { value: 'test-secret' } })
  expect((screen.getByRole('button', { name: 'Save credentials' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('region *'), { target: { value: 'eu' } })
  pick('Save credentials')
  await screen.findByText('Credentials saved')
  expect(saveMcpCredentials).toHaveBeenCalledWith('exa', { apiKey: 'test-secret', region: 'eu' }, undefined)
  expect(onChange).not.toHaveBeenCalled()
  pick('Save MCPs (2)')
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ servers: ['openai_docs', 'exa'], tool_search: false, options: {} }))
  expect(JSON.stringify(localStorage)).not.toContain('test-secret')
})

it('reuses saved credentials without returning the values to inputs', async () => {
  fetchMcpCredentials.mockResolvedValue({ options: { exa: { apiKey: '•', region: '•' } } })
  renderPicker()
  await openPicker()
  pick('Exa')
  expect(screen.queryByLabelText('apiKey *')).toBeNull()
  pick('Configure Exa')
  expect((screen.getByLabelText('apiKey *') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('apiKey *') as HTMLInputElement).placeholder).toContain('Saved')
})

it('keeps failed credential saves editable and does not select an unconfigured MCP', async () => {
  saveMcpCredentials.mockRejectedValue(new Error('Save failed'))
  renderPicker()
  await openPicker()
  pick('Exa')
  fireEvent.change(screen.getByLabelText('apiKey *'), { target: { value: 'test-secret' } })
  fireEvent.change(screen.getByLabelText('region *'), { target: { value: 'eu' } })
  pick('Save credentials')
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Save failed')
  expect((screen.getByLabelText('apiKey *') as HTMLInputElement).value).toBe('test-secret')
  pick('Back')
  expect(screen.getByRole('button', { name: 'Exa' }).getAttribute('aria-pressed')).toBe('false')
})

it('keeps errors visible when applying changes to an existing chat fails', async () => {
  renderPicker({ locked: true, onChange: async () => { throw new Error('Try again') } })
  await openPicker()
  pick('Fetch')
  pick('Save MCPs (2)')
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Try again')
})

it('saves additions and removals during a running turn', async () => {
  const onChange = renderPicker({ locked: true, busy: true })
  fireEvent.click(screen.getByRole('button', { name: 'MCP servers' }))
  await screen.findByRole('button', { name: 'Fetch' })
  pick('Fetch')
  pick('OpenAI Docs')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save MCPs (1)' }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByText('Save now. Changes apply automatically before the next turn.')).toBeTruthy()
  pick('Save MCPs (1)')
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ servers: ['fetch'], tool_search: false, options: {} }))
})

it('updates the current chat and its status cache without changing new-chat defaults', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const snapshot = { chat_id: 'mcp-chat', agent_locked: true, active: false,
    capabilities: { mcp: { servers: ['openai_docs'], tool_search: false } } } as SessionSnapshot
  const updated = { ...snapshot, session_id: 'new-session', capabilities: { mcp: { servers: ['openai_docs', 'fetch'], tool_search: false } } }
  setMcpSelection.mockResolvedValue(updated)
  render(<QueryClientProvider client={client}><AgentControls snapshot={snapshot} started /></QueryClientProvider>)
  await openPicker()
  pick('Fetch')
  pick('Save MCPs (2)')
  await waitFor(() => expect(client.getQueryData(['status', 'mcp-chat'])).toEqual(updated))
  expect(setMcpSelection).toHaveBeenCalledWith('mcp-chat', { servers: ['openai_docs', 'fetch'], tool_search: false, options: {} })
})

it('pins catalog favorites first without duplicates or automatically selecting them', async () => {
  renderPicker()
  await openPicker()
  const pinned = screen.getByRole('region', { name: 'Pinned · E2B catalog' })
  expect(within(pinned).getAllByRole('button').map((row) => row.getAttribute('aria-label')))
    .toEqual(['Hacker News', 'Context7', 'DeepWiki'])
  for (const name of ['Hacker News', 'Context7', 'DeepWiki']) {
    expect(screen.getAllByRole('button', { name })).toHaveLength(1)
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
  }
  pick('Context7')
  expect(screen.getByRole('button', { name: 'Context7' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search MCP servers' }), { target: { value: 'DeepWiki' } })
  expect(screen.queryByRole('button', { name: 'Context7' })).toBeNull()
  expect(screen.getByRole('button', { name: 'DeepWiki' })).toBeTruthy()
})

it('shows the pending selection and its status while retaining active session metadata', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const snapshot = { chat_id: 'mcp-chat', session_id: 'old-session', agent_locked: true, active: true,
    pending_mcp: { servers: ['fetch'], tool_search: true },
    capabilities: { mcp: { servers: ['openai_docs'], tool_search: false } } } as SessionSnapshot
  render(<QueryClientProvider client={client}><AgentControls snapshot={snapshot} started /></QueryClientProvider>)
  expect(screen.getByRole('status').textContent).toBe('MCP changes saved for the next turn')
  await openPicker()
  expect(screen.getByRole('button', { name: 'Fetch' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'OpenAI Docs' }).getAttribute('aria-pressed')).toBe('false')
})
