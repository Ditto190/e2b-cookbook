import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatEvent, SessionSnapshot } from '@/api/client'
import { AgentControls } from '@/components/chat/agent-controls'
import { Transcript } from '@/components/chat/transcript'
import { setAgentSettings } from '@/lib/agent-settings'
import { dropChat, sendChatPrompt, useChatState, type Turn } from '@/lib/chat-store'
import { getSession } from '@/lib/sessions'

const { streamChat } = vi.hoisted(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  return { streamChat: vi.fn() }
})
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
  chat_id: 'reasoning-chat', connected: false, paused: false,
  session_id: 'sess-test', environment_id: null, executor_pid: null,
  active: false, cancel_ready: false, sandbox: null, workspace: '/workspace',
  model: 'gpt-5.6-sol', reasoning_effort: null, verbosity: null,
  service_tier: null, agent_locked: true, env_key_available: true,
  timeout_at: null, terminal_reason: null,
  capabilities: { reasoning_summary: { enabled: true } },
}

function Chat({ session }: { session?: SessionSnapshot }) {
  const state = useChatState('reasoning-chat')
  return <>
    <AgentControls snapshot={session} started={state.turns.length > 0}
      capabilities={getSession('reasoning-chat')?.capabilities} />
    <button onClick={() => sendChatPrompt('reasoning-chat', 'Hello')}>Send</button>
    <Transcript turns={state.turns} />
  </>
}

function renderChat(session?: SessionSnapshot) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Chat session={session} /></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  dropChat('reasoning-chat')
  streamChat.mockReset()
  setAgentSettings({ capabilities: { reasoning_summary: { enabled: true }, memory: { enabled: true } } })
})

it('always sends reasoning summary and shared memory on, with no switch for either', async () => {
  streamChat.mockImplementation(async function* () {
    yield { type: 'done', status: 'idle', session: snapshot }
  })
  renderChat()
  expect(screen.queryByRole('switch', { name: 'Reasoning summary' })).toBeNull()
  expect(screen.queryByRole('switch', { name: 'Shared memory' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(streamChat).toHaveBeenCalledOnce())
  expect(streamChat.mock.calls[0]?.[0].capabilities.reasoning_summary).toEqual({ enabled: true })
  expect(streamChat.mock.calls[0]?.[0].capabilities.memory).toEqual({ enabled: true })
})

it('streams reasoning in a collapsed block above the answer and replaces missed text', async () => {
  let resume!: () => void
  const gate = new Promise<void>((resolve) => { resume = resolve })
  streamChat.mockImplementation(async function* (): AsyncGenerator<ChatEvent> {
    yield { type: 'reasoning', delta: 'First thought' }
    await gate
    yield { type: 'reasoning', delta: ' continues' }
    yield { type: 'reasoning', text: 'Repaired summary' }
    yield { type: 'text', text: 'Answer text' }
    yield { type: 'done', status: 'idle', session: snapshot }
  })
  renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  const summary = await screen.findByText('Reasoning', { selector: 'summary' })
  const block = summary.closest('details')!
  expect(block.open).toBe(false)
  fireEvent.click(summary)
  expect(block.open).toBe(true)
  expect(screen.getByText('First thought')).toBeTruthy()
  await act(async () => resume())
  expect(screen.getByText('Repaired summary')).toBeTruthy()
  expect(screen.queryByText('First thought')).toBeNull()
  expect(block.compareDocumentPosition(screen.getByText('Answer text')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(block.open).toBe(true)
})

it('renders reloaded and forked reasoning as collapsed history and hides absent summaries', () => {
  const turn: Turn = { id: 1, prompt: 'Hello', text: 'Answer', phase: null, activities: [], outcome: 'done', reasoning: null }
  const view = render(<Transcript turns={[turn]} sessionKey="parent" />)
  expect(screen.queryByText('Reasoning')).toBeNull()
  view.rerender(<Transcript turns={[{ ...turn, reasoning: 'Saved summary' }]} sessionKey="fork" />)
  const block = screen.getByText('Reasoning', { selector: 'summary' }).closest('details')!
  expect(block.open).toBe(false)
  fireEvent.click(screen.getByText('Reasoning', { selector: 'summary' }))
  expect(block.open).toBe(true)
  expect(screen.getByText('Saved summary')).toBeTruthy()
  view.rerender(<Transcript turns={[{ ...turn, reasoning: 'Saved summary' }]} sessionKey="another-fork" />)
  expect(screen.getByText('Reasoning', { selector: 'summary' }).closest('details')!.open).toBe(false)
})
