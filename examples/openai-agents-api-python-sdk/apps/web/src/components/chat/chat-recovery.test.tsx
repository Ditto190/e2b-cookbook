import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatFootnote, UsageFootnote } from '@/components/chat/chat-footnote'
import type { ChatEvent, SessionSnapshot } from '@/api/client'
import { setShowActivity } from '@/lib/settings'
import { Transcript } from '@/components/chat/transcript'
import {
  dropChat,
  sendChatPrompt,
  seedChat,
  useChatState,
  isTurnForkable,
  isTurnTerminal,
  type Turn,
} from '@/lib/chat-store'


vi.mock('@/components/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))

vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  getAutoPause: () => false,
}))

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
HTMLElement.prototype.scrollTo = vi.fn()

beforeEach(() => {
  setShowActivity(false)
})

afterEach(() => {
  cleanup()
  dropChat('usage-chat')
  vi.restoreAllMocks()
})

function failedTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 1,
    prompt: 'continue',
    phase: null,
    activities: [],
    text: '',
    outcome: 'error',
    error: 'The agent run failed: 500 internal_error',
    ...overrides,
  }
}

describe('chat recovery', () => {
  it('offers a sibling fork for a retryable upstream failure', () => {
    const onFork = vi.fn()
    const turn = failedTurn({ forkable: true, terminal: false })

    expect(isTurnForkable(turn)).toBe(true)
    expect(isTurnTerminal(turn)).toBe(false)

    render(<Transcript onFork={onFork} turns={[turn]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fork to continue' }))

    expect(onFork).toHaveBeenCalledOnce()
  })

  it('keeps archived terminal errors recoverable', () => {
    const turn = failedTurn({ errorCode: 'decayed' })

    expect(isTurnForkable(turn)).toBe(true)
    expect(isTurnTerminal(turn)).toBe(true)
  })

  it('replaces a terminal thread composer with a guarded recovery action', () => {
    const onFork = vi.fn()

    render(
      <ChatFootnote
        expired={false}
        forkable
        forking
        onFork={onFork}
        onNew={vi.fn()}
        onRetry={vi.fn()}
        terminal
      />
    )

    const recover = screen.getByRole('button', { name: 'Recovering…' })
    expect((recover as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(recover)
    expect(onFork).not.toHaveBeenCalled()
  })
})

describe('turn usage', () => {
  it('shows archived totals with coverage and contained subsets without adding session usage', () => {
    const turns = [
      failedTurn({ upstreamTurnId: 'turn-one', usage: { input_tokens: 100, output_tokens: 30,
        input_tokens_details: { cached_tokens: 50 }, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 130 } }),
      failedTurn({ id: 2, upstreamTurnId: 'turn-two', usage: { input_tokens: 60, output_tokens: 10,
        input_tokens_details: { cached_tokens: 10 }, total_tokens: 70 } }),
      failedTurn({ id: 3 }),
      failedTurn({ id: 4, prompt: '', outcome: 'done' }),
    ]
    const snapshot = { session_id: 'sess-test', trace_url: null, usage: { total_tokens: 999999 } } as unknown as SessionSnapshot
    render(<UsageFootnote snapshot={snapshot} turns={turns} />)
    expect(screen.getByText(/Chat tokens:/).textContent).toContain('160 input (60 cached), 40 output (10 reasoning), 200 total')
    expect(screen.getByText(/partial \(2 of 3 turns\)/)).toBeTruthy()
    expect(screen.queryByText(/999999|root agent only/)).toBeNull()
  })

  it('omits missing counters in the transcript and labels delegated root usage', () => {
    render(<Transcript rootAgentOnly turns={[failedTurn({ usage: { output_tokens: 7 } })]} />)
    expect(screen.getByText('Turn tokens: 7 output · root agent only')).toBeTruthy()
    expect(screen.queryByText(/0 input|0 cached|0 reasoning/)).toBeNull()
  })

  it('copies the session id without a trace link and enables a configured link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const snapshot = { session_id: 'sess-test', trace_url: null,
      capabilities: { delegation: { enabled: true } } } as unknown as SessionSnapshot
    const { rerender } = render(<UsageFootnote snapshot={snapshot} turns={[]} />)
    expect(screen.getByText('root agent only')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open trace' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy session id sess-test' }))
    expect(writeText).toHaveBeenCalledWith('sess-test')
    rerender(<UsageFootnote snapshot={{ ...snapshot, trace_url: 'https://trace.example.test/sess-test' }} turns={[]} />)
    expect(screen.getByRole('link', { name: 'Open trace' }).getAttribute('href')).toBe('https://trace.example.test/sess-test')
  })
})

describe('streamed usage', () => {
  it('updates the completed transcript from deferred usage without double counting replay', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null, setItem: vi.fn(),
    } })
    let stream!: ReadableStreamDefaultController<Uint8Array>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { stream = controller },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const emit = (event: ChatEvent) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    function Chat() {
      const { turns, active } = useChatState('usage-chat')
      return <><span>{active ? 'Chat busy' : 'Chat ready'}</span><Transcript turns={turns} /><UsageFootnote turns={turns} /></>
    }
    render(<Chat />)
    act(() => sendChatPrompt('usage-chat', 'Count usage'))
    await act(async () => emit({ type: 'error', turn_id: 'turn-stream', message: 'Tool failed' }))
    expect(screen.getByText('Tool failed')).toBeTruthy()
    expect(screen.getByText('Chat ready')).toBeTruthy()
    expect(screen.getByText(/partial \(0 of 1 turns\)/)).toBeTruthy()
    await act(async () => {
      emit({ type: 'usage', turn_id: 'turn-stream', usage: { input_tokens: 10, output_tokens: 2 } })
      emit({ type: 'usage', turn_id: 'turn-stream', usage: { input_tokens: 10, output_tokens: 2 } })
      emit({ type: 'usage', turn_id: 'turn-stale', usage: { input_tokens: 999 } })
      stream.close()
    })
    await waitFor(() => expect(screen.getByText(/Chat tokens:/).textContent).toContain('10 input, 2 output, 12 total · (1 of 1 turns)'))
    expect(screen.getAllByText('Turn tokens: 10 input, 2 output')).toHaveLength(1)
    expect(screen.getByText('Tool failed')).toBeTruthy()
  })
})

describe('partial usage footnote', () => {
  it('shows supplied zero counters and omits unavailable values without repeating turn tokens', () => {
    render(<UsageFootnote turns={[
      failedTurn({ id: 1 }),
      failedTurn({ id: 2, usage: { output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 } } }),
      failedTurn({ id: 3, prompt: '', outcome: 'done' }),
    ]} />)
    expect(screen.queryByText(/^Turn tokens:/)).toBeNull()
    expect(screen.getByText(/Chat tokens:/).textContent).toBe('Chat tokens: 0 output (0 reasoning) · partial (1 of 2 turns)')
    expect(screen.queryByText(/0 input|0 total|0 cached/)).toBeNull()
  })
})

describe('queued turns during usage lookup', () => {
  it('starts the next prompt before usage arrives and keeps its active state after the old stream ends', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null, setItem: vi.fn(),
    } })
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { streams.push(controller) },
    })))
    const emit = (index: number, event: ChatEvent) => streams[index]!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    function Chat() {
      const { turns, active } = useChatState('usage-chat')
      return <><span>{active ? 'Chat busy' : 'Chat ready'}</span><UsageFootnote turns={turns} /></>
    }
    render(<Chat />)
    act(() => {
      sendChatPrompt('usage-chat', 'First prompt')
      sendChatPrompt('usage-chat', 'Next prompt')
    })
    const session = { session_id: 'sess-test', sandbox: null } as SessionSnapshot
    await act(async () => emit(0, { type: 'done', turn_id: 'turn-first', status: 'idle', session }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await act(async () => {
      emit(0, { type: 'usage', turn_id: 'turn-first', usage: { input_tokens: 3, output_tokens: 1 } })
      streams[0]!.close()
    })
    expect(screen.getByText('Chat busy')).toBeTruthy()
    expect(screen.getByText('Chat tokens: 3 input, 1 output, 4 total · (1 of 1 turns)')).toBeTruthy()
    await act(async () => {
      emit(1, { type: 'error', turn_id: 'turn-next', message: 'Next turn failed' })
      streams[1]!.close()
    })
    expect(screen.getByText('Chat ready')).toBeTruthy()
    expect(screen.getByText(/partial \(1 of 2 turns\)/)).toBeTruthy()
  })
})

describe('archive refresh during usage lookup', () => {
  it('does not apply an old EOF to a newer archived turn with the same local id', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null, setItem: vi.fn(),
    } })
    let stream!: ReadableStreamDefaultController<Uint8Array>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { stream = controller },
    })))
    function Chat() {
      const { turns, active } = useChatState('usage-chat')
      return <><span>{active ? 'Chat busy' : 'Chat ready'}</span>{turns.map((turn) =>
        <p key={turn.id}>{turn.id}: {turn.prompt}: {turn.outcome}</p>)}</>
    }
    render(<Chat />)
    act(() => sendChatPrompt('usage-chat', 'Local prompt'))
    const localId = Number(screen.getByText(/Local prompt: running/).textContent?.split(':')[0])
    await act(async () => stream.enqueue(new TextEncoder().encode(
      `data: ${JSON.stringify({ type: 'error', turn_id: 'turn-local', message: 'Failed' })}\n\n`
    )))
    act(() => seedChat('usage-chat', [
      failedTurn({ id: localId + 100, upstreamTurnId: 'turn-local', prompt: 'Local prompt' }),
      failedTurn({ id: localId, upstreamTurnId: 'turn-remote', prompt: 'Remote prompt', outcome: 'running' }),
    ]))
    await act(async () => stream.close())
    expect(screen.getByText(/Remote prompt: running/)).toBeTruthy()
    expect(screen.getByText('Chat busy')).toBeTruthy()
  })
})

describe('usage details in the activity log', () => {
  it('keeps turn tokens visible and toggles cumulative details below each completed turn', () => {
    const turns = [
      failedTurn({ outcome: 'done', usage: { input_tokens: 10, output_tokens: 2 } }),
      failedTurn({ id: 2, outcome: 'done', usage: { input_tokens: 20, output_tokens: 3 } }),
    ]
    const props = { turns, sessionId: 'sess-activity' }
    render(<Transcript {...props} />)
    expect(screen.getAllByText(/^Turn tokens:/)).toHaveLength(2)
    expect(screen.queryByText(/^Chat tokens:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy session id sess-activity' })).toBeNull()

    act(() => setShowActivity(true))
    const first = screen.getByText('Chat tokens: 10 input, 2 output, 12 total · (1 of 1 turns)')
    const second = screen.getByText('Chat tokens: 30 input, 5 output, 35 total · (2 of 2 turns)')
    const turnLines = screen.getAllByText(/^Turn tokens:/)
    expect(turnLines).toHaveLength(2)
    expect(turnLines[0]!.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(first.compareDocumentPosition(turnLines[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(turnLines[1]!.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Copy session id sess-activity' })).toHaveLength(2)

    act(() => setShowActivity(false))
    expect(screen.getAllByText(/^Turn tokens:/)).toHaveLength(2)
    expect(screen.queryByText(/^Chat tokens:/)).toBeNull()
  })
})
