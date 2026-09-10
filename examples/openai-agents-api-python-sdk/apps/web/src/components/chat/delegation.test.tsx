// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatEvent, SessionSnapshot } from '@/api/client'
import { setAgentSettings } from '@/lib/agent-settings'
import { dropChat, sendChatPrompt, useChatState, type Turn } from '@/lib/chat-store'
import { getSession } from '@/lib/sessions'
import { AgentControls } from './agent-controls'
import { Transcript } from './transcript'

const { streamChat } = vi.hoisted(() => ({ streamChat: vi.fn() }))
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  streamChat,
  fetchModels: async () => ({ models: [] }),
  fetchMcpServers: async () => ({ servers: [], default: [] }),
}))
vi.mock('@/components/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
HTMLElement.prototype.scrollTo = vi.fn()

const snapshot: SessionSnapshot = {
  chat_id: 'delegation-chat', connected: false, paused: false,
  session_id: 'sess-test', environment_id: null, executor_pid: null,
  active: false, cancel_ready: false, sandbox: null, workspace: '/workspace',
  model: 'gpt-5.6-sol', reasoning_effort: null, verbosity: null,
  service_tier: null, agent_locked: true, env_key_available: true,
  timeout_at: null, terminal_reason: null,
  capabilities: { delegation: { enabled: true, max_agents: 4 } },
  subagents: { open: 2, known: true },
}

function Chat({ session }: { session?: SessionSnapshot }) {
  const state = useChatState('delegation-chat')
  return <>
    <AgentControls snapshot={session} started={state.turns.length > 0}
      capabilities={getSession('delegation-chat')?.capabilities} />
    <button onClick={() => sendChatPrompt('delegation-chat', 'Review modules')}>Send</button>
    <Transcript turns={state.turns} />
  </>
}

function renderChat(session?: SessionSnapshot) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><Chat session={session} /></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  dropChat('delegation-chat')
  streamChat.mockReset()
  setAgentSettings({ capabilities: { reasoning_summary: { enabled: true }, delegation: { enabled: true, max_agents: 3 } } })
})

it('always sends delegation on with max 3 and shows no delegation controls', async () => {
  streamChat.mockImplementation(async function* () {
    yield { type: 'done', status: 'idle', session: snapshot }
  })
  renderChat()
  // Always-on capability: the composer carries no switch or max input.
  expect(screen.queryByRole('switch', { name: 'Delegation' })).toBeNull()
  expect(screen.queryByRole('spinbutton', { name: 'Max subagents' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(streamChat).toHaveBeenCalledOnce())
  expect(streamChat.mock.calls[0]?.[0].capabilities.delegation).toEqual({ enabled: true, max_agents: 3 })
})

it('shows the open subagent count only while some are open', () => {
  const client = new QueryClient()
  const view = (session: SessionSnapshot) => <QueryClientProvider client={client}><Chat session={session} /></QueryClientProvider>
  const rendered = render(view(snapshot))
  expect(screen.getByText('2 open subagents')).toBeTruthy()
  expect(screen.queryByRole('switch', { name: 'Delegation' })).toBeNull()
  expect(screen.queryByRole('spinbutton', { name: 'Max subagents' })).toBeNull()
  // Nothing open, or lost track after a reconnect: no pill at all.
  rendered.rerender(view({ ...snapshot, subagents: { open: 0, known: true } }))
  expect(screen.queryByRole('status')).toBeNull()
  rendered.rerender(view({ ...snapshot, subagents: { open: null, known: false } }))
  expect(screen.queryByRole('status')).toBeNull()
  rendered.rerender(view({ ...snapshot, capabilities: { delegation: { enabled: false, max_agents: 3 } } }))
  expect(screen.queryByText('2 open subagents')).toBeNull()
})

it('renders streamed delegation labels, identity and task text with generic fallback rows', async () => {
  streamChat.mockImplementation(async function* (): AsyncGenerator<ChatEvent> {
    for (const [index, label] of ['Spawn subagent', 'Send subagent input', 'Wait for subagents', 'Resume subagent', 'Close subagent', 'Agent message'].entries()) {
      yield { type: 'activity', id: `rich-${index}`, tone: 'done', label, agent_id: `agent-${index}`, detail: `Task ${index}` }
      yield { type: 'activity', id: `generic-${index}`, tone: 'done', label }
    }
    yield { type: 'done', status: 'idle', session: snapshot }
  })
  renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Task 5')
  for (const [index, label] of ['Spawn subagent', 'Send subagent input', 'Wait for subagents', 'Resume subagent', 'Close subagent', 'Agent message'].entries()) {
    expect(screen.getAllByText(label)).toHaveLength(2)
    expect(screen.getByText(`agent-${index}`)).toBeTruthy()
    expect(screen.getByText(`Task ${index}`)).toBeTruthy()
  }
})

it('groups interleaved command rows by agent and labels unknown attribution', async () => {
  streamChat.mockImplementation(async function* (): AsyncGenerator<ChatEvent> {
    yield { type: 'activity', id: 'root', tone: 'done', label: 'Finished command', detail: 'root command' }
    yield { type: 'activity', id: 'a1', agent_id: 'a', tone: 'running', label: 'Running command', detail: 'first a' }
    yield { type: 'activity', id: 'b1', agent_id: 'b', tone: 'done', label: 'Finished command', detail: 'first b' }
    yield { type: 'activity', id: 'a1', agent_id: 'a', tone: 'done', label: 'Finished command', detail: 'first a' }
    yield { type: 'activity', id: 'a2', agent_id: 'a', tone: 'done', label: 'Finished command', detail: 'second a' }
    yield { type: 'activity', id: 'u1', agent_id: 'unknown', tone: 'done', label: 'Finished command', detail: 'unknown command' }
    yield { type: 'done', status: 'idle', session: snapshot }
  })
  renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('unknown command')
  const a = within(screen.getByRole('group', { name: 'Subagent a' }))
  expect(a.getAllByTitle('Copy command').map(row => row.textContent)).toEqual(['first a', 'second a'])
  expect(a.queryByText('Running command')).toBeNull()
  expect(a.queryByText('first b')).toBeNull()
  expect(within(screen.getByRole('group', { name: 'Subagent b' })).getByText('first b')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: 'Attribution unknown' })).getByText('unknown command')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: 'Root agent' })).getByText('root command')).toBeTruthy()
})

it('groups archived attribution after reload and keeps plain history flat', () => {
  const turn: Turn = {
    id: 1, prompt: 'Hello', text: 'Answer', phase: null, outcome: 'done',
    activities: [{ tone: 'done', label: 'Finished command', detail: 'pwd' }],
  }
  const view = render(<Transcript turns={[turn]} sessionKey="parent" />)
  expect(screen.queryByRole('group')).toBeNull()
  expect(screen.getByText('pwd')).toBeTruthy()
  const attributed: Turn = { ...turn, activities: [
    { tone: 'done', label: 'Finished command', detail: 'pwd', agent_id: 'a' },
    { tone: 'done', label: 'Finished command', detail: 'pwd', agent_id: 'b' },
    { tone: 'done', label: 'Finished command', detail: 'unresolved', agent_id: 'unknown' },
  ] }
  for (const sessionKey of ['reloaded', 'fork']) {
    view.rerender(<Transcript turns={[attributed]} sessionKey={sessionKey} />)
    expect(within(screen.getByRole('group', { name: 'Subagent a' })).getByText('pwd')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Subagent b' })).getByText('pwd')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Attribution unknown' })).getByText('unresolved')).toBeTruthy()
  }
})
