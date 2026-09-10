import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ComposerSection } from '@/components/chat/composer-section'
import { Composer } from '@/components/chat/composer'
import { SteeringStack } from '@/components/chat/queued-message'
import { Transcript } from '@/components/chat/transcript'
import { cancelChatTurn, dropChat, removeQueuedPrompt, seedChat, sendChatPrompt, steerChatPrompt, useChatState, type Turn } from '@/lib/chat-store'

vi.mock('@/api/client', async (original) => ({ ...(await original<typeof import('@/api/client')>()), getClientId: () => 'viewer-self' }))
vi.mock('@/components/chat/agent-controls', () => ({ AgentControls: () => null }))
vi.mock('@/components/api-key-settings', () => ({ ApiKeyPanel: () => null }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/wake-toast', () => ({ announceSandboxWake: vi.fn() }))
vi.mock('@/lib/settings', () => ({ useShowActivity: () => false, getAutoPause: () => false }))
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
HTMLElement.prototype.scrollTo = vi.fn()
afterEach(() => { cleanup(); dropChat('steer-chat'); vi.useRealTimers(); vi.unstubAllGlobals() })

it('queues by default and steers only with Cmd+Enter during a run', () => {
  const send = vi.fn()
  const steer = vi.fn()
  const next = vi.fn()
  const { rerender } = render(<Composer onSend={send} onSteer={steer} onSteerQueued={next} streaming />)
  expect(screen.queryByRole('group', { name: 'Message mode' })).toBeNull()
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'first queued' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.change(input, { target: { value: 'also queued' } })
  fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
  expect(send.mock.calls).toEqual([['first queued'], ['also queued']])
  expect(steer).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'focus here' } })
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(steer).toHaveBeenCalledWith('focus here')
  expect(next).not.toHaveBeenCalled()
  expect((input as HTMLTextAreaElement).value).toBe('')
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(next).toHaveBeenCalledOnce()
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true, repeat: true })
  expect(next).toHaveBeenCalledOnce()
  fireEvent.change(input, { target: { value: 'keep drafting' } })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true, isComposing: true })
  expect((input as HTMLTextAreaElement).value).toBe('keep drafting')
  expect(steer).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Stop the turn' })).toBeTruthy()
  rerender(<Composer onSend={send} onSteer={steer} onSteerQueued={next} />)
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(send).toHaveBeenLastCalledWith('keep drafting')
  expect(steer).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy()
})

it('shows pending steering as queue chips and resolved messages without steering status cards', () => {
  const statuses = ['sending', 'posted', 'confirmed', 'became_turn', 'unconfirmed', 'refused', 'cancelled'] as const
  const turn: Turn = {
    id: 1, prompt: 'start', phase: null, activities: [], text: 'answer', outcome: 'done',
    interjections: statuses.map((status, i) => ({ submission_id: `s${i}`, text: `message ${i}`, status, by: 'other-viewer', at: Date.now() - 5000 })),
  }
  const adopted: Turn = { id: 2, prompt: 'message 3', phase: null, text: 'follow-up answer', activities: [], outcome: 'done', from_submission_id: 's3' }
  render(<><Transcript turns={[turn, adopted]} sessionKey="steer-chat" /><SteeringStack turns={[turn, adopted]} /></>)
  expect(screen.getAllByText(/^Steering/)).toHaveLength(2)
  expect(screen.getAllByText(/^Steering · Other viewer/)).toHaveLength(2)
  for (const label of ['Sending', 'Posted', 'Confirmed in this turn', 'Started a new turn', 'Refused', 'Cancelled']) {
    expect(screen.queryByText(label)).toBeNull()
  }
  expect(screen.getAllByText('Other viewer')).toHaveLength(5)
  expect(screen.getAllByRole('button', { name: 'Send as new prompt' })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Remove queued message' })).toBeNull()
  expect(screen.getAllByText(/^message /).map((node) => node.textContent)).toEqual(['message 2', 'message 4', 'message 5', 'message 6', 'message 3', 'message 1', 'message 0'])

})

function ChatHarness() {
  const state = useChatState('steer-chat')
  return <>
    <Transcript turns={state.turns} sessionKey="steer-chat" />
    <ComposerSection
      viewExpired={false} forkable={false} terminal={false} resumeFailed={false}
      onFork={() => {}} forking={false} onNew={() => {}} onRetry={() => {}}
      turnCount={state.turns.length} keysMissing={false} active={state.active}
      queued={state.queued} turns={state.turns} steering={state.steering}
      onUnqueue={(index) => removeQueuedPrompt('steer-chat', index)}
      onSend={(text) => sendChatPrompt('steer-chat', text)}
      onSteer={(text) => steerChatPrompt('steer-chat', text)}
      onCancel={() => cancelChatTurn('steer-chat')}
      showScrollDown={false} onScrollToBottom={() => {}} mentionFiles={undefined} snapshot={undefined}
    />
    <p>Queued: {state.queued.join(', ')}</p>
  </>
}

function mockStream() {
  const pulls: ReadableStreamDefaultController<Uint8Array>[] = []
  const prompts: string[] = []
  const fetcher = vi.fn((path: string, init?: RequestInit) => {
    if (path !== '/api/chat') throw new Error(`Unexpected request: ${path}`)
    prompts.push(JSON.parse(init!.body as string).prompt)
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { pulls.push(controller) } })))
  })
  vi.stubGlobal('fetch', fetcher)
  const emit = (event: object, index = 0) => pulls[index]!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return { pulls, prompts, emit, fetcher }
}

it('keeps queued prompts parked through adopted output until the entire stream ends', async () => {
  const { pulls, prompts, emit } = mockStream()
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'initial' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'queued after run' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  await act(async () => {
    emit({ type: 'interjection', submission_id: 's1', text: 'focus', status: 'posted', by: 'viewer-self', at: Date.now() })
    emit({ type: 'interjection', submission_id: 's1', text: 'focus', status: 'became_turn', by: 'viewer-self', at: Date.now() })
    emit({ type: 'turn_started', from_submission_id: 's1', prompt: 'focus', previous_outcome: 'done' })
    emit({ type: 'delta', text: 'adopted output' })
  })
  expect(screen.getByText('adopted output')).toBeTruthy()
  expect(screen.getByText('Queued: queued after run')).toBeTruthy()
  expect(prompts).toEqual(['initial'])
  await act(async () => emit({ type: 'done', status: 'idle', session: {} }))
  expect(prompts).toEqual(['initial'])
  await act(async () => pulls[0]!.close())
  await waitFor(() => expect(prompts).toEqual(['initial', 'queued after run']))
  await act(async () => { emit({ type: 'done', status: 'idle', session: {} }, 1); pulls[1]!.close() })
})

it('waits through no_active_turn and steers with the same submission ID without queueing', async () => {
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  const fetcher = vi.fn((_path: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string)
    return Promise.resolve(new Response(JSON.stringify({ ...body, status: 'posted', by: 'viewer-self', at: Date.now() })))
  })
  fetcher.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: 'no_active_turn', error: 'No active turn', preview_text: 'focus' }), { status: 409 })))
  vi.stubGlobal('fetch', fetcher)
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
  expect(screen.getByText('Steering')).toBeTruthy()
  expect(screen.queryByText('Waiting to steer')).toBeNull()
  await waitFor(() => expect(screen.getByText('focus')).toBeTruthy())
  expect(fetcher).toHaveBeenCalledTimes(1)
  act(() => seedChat('steer-chat', [{ ...turn, text: 'Still working' }]))
  expect(screen.getByText('focus')).toBeTruthy()
  expect(screen.getByText('Queued:')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
  expect(toast.info).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(screen.getAllByText('focus')).toHaveLength(1)
  expect(screen.getAllByText('Steering')).toHaveLength(1)
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/steer', '/api/steer'])
  expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
  expect(screen.getByText('Queued:')).toBeTruthy()
})

it('keeps a polling viewer queue parked across the archived adopted boundary', async () => {
  const { pulls, prompts, emit } = mockStream()
  const root: Turn = { id: 1, prompt: 'remote', phase: null, text: 'root output', activities: [], outcome: 'running' }
  seedChat('steer-chat', [root])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my queued prompt' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  const adopted: Turn = { ...root, id: 2, prompt: 'steering input', from_submission_id: 's1', text: 'adopted output' }
  act(() => seedChat('steer-chat', [{ ...root, outcome: 'done' }, adopted]))
  expect(prompts).toEqual([])
  expect(screen.getByText('Queued: my queued prompt')).toBeTruthy()
  await act(async () => seedChat('steer-chat', [{ ...root, outcome: 'done' }, { ...adopted, outcome: 'done' }]))
  expect(prompts).toEqual(['my queued prompt'])
  await act(async () => { emit({ type: 'done', status: 'idle', session: {} }); pulls[0]!.close() })
})

it('releases the adopted run before deferred usage and keeps usage on its upstream root', async () => {
  const { pulls, prompts, emit } = mockStream()
  function UsageState() {
    const state = useChatState('steer-chat')
    return <pre data-testid="usage-state">{JSON.stringify(state)}</pre>
  }
  render(<><ChatHarness /><UsageState /></>)
  act(() => {
    sendChatPrompt('steer-chat', 'initial')
    sendChatPrompt('steer-chat', 'next queued')
  })
  await act(async () => emit({ type: 'turn_started', prompt: 'focus', from_submission_id: 's1',
    previous_outcome: 'done', previous_turn_id: 'root-1', previous_usage: { input_tokens: 11 } }))
  expect(prompts).toEqual(['initial'])
  await act(async () => emit({ type: 'done', status: 'idle', session: {}, turn_id: 'root-2', run_complete: true }))
  await waitFor(() => expect(prompts).toEqual(['initial', 'next queued']))
  await act(async () => {
    emit({ type: 'usage', turn_id: 'root-2', usage: { output_tokens: 7 } })
    pulls[0]!.close()
  })
  const state = JSON.parse(screen.getByTestId('usage-state').textContent!)
  expect(state.active).toBe(true)
  expect(state.turns[0].usage).toEqual({ input_tokens: 11 })
  expect(state.turns[1].usage).toEqual({ output_tokens: 7 })
  expect(state.turns[2].outcome).toBe('running')
  await act(async () => { emit({ type: 'done', status: 'idle', session: {} }, 1); pulls[1]!.close() })
})

it('posts Cmd+Enter to steer and leaves the regular queue untouched when admitted', async () => {
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: 'Working', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  const fetcher = vi.fn((_path: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string)
    return Promise.resolve(new Response(JSON.stringify({
      submission_id: body.submission_id, text: body.text,
      status: 'posted', by: 'viewer-self', at: Date.now(),
    })))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'say hello Czechia' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
  await waitFor(() => expect(screen.getByText('Steering')).toBeTruthy())
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![0]).toBe('/api/steer')
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
    chat_id: 'steer-chat', text: 'say hello Czechia', client_id: 'viewer-self',
  })
  expect(screen.getByText('Queued:')).toBeTruthy()
  expect(screen.getByText('say hello Czechia')).toBeTruthy()
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string)
  act(() => seedChat('steer-chat', [{ ...turn, outcome: 'done', interjections: [{
    submission_id: body.submission_id, text: body.text, status: 'confirmed', by: 'viewer-self', at: Date.now(),
  }] }]))
  expect(screen.queryByText('Steering')).toBeNull()
  expect(screen.getAllByText('say hello Czechia')).toHaveLength(1)
  expect(screen.queryByText('Confirmed in this turn')).toBeNull()
})

it.each(['stop', 'drop'] as const)('cancels admission waiting on %s without a delayed prompt', async (action) => {
  vi.useFakeTimers()
  const fetcher = vi.fn((path: string) => Promise.resolve(new Response(
    JSON.stringify(path === '/api/steer' ? { code: 'no_active_turn', error: 'No active turn' } : {}),
    { status: path === '/api/steer' ? 409 : 200 },
  )))
  vi.stubGlobal('fetch', fetcher)
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus' } })
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true }))
  await act(async () => {
    if (action === 'stop') fireEvent.click(screen.getByRole('button', { name: 'Stop the turn' }))
    else dropChat('steer-chat')
    seedChat('steer-chat', [{ ...turn, outcome: 'done' }])
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(action === 'stop' ? ['/api/steer', '/api/cancel'] : ['/api/steer'])
  expect(screen.getByText('Queued:')).toBeTruthy()
})

it('sends as the next prompt silently when the run finishes during admission waiting', async () => {
  vi.useFakeTimers()
  const { pulls, prompts, emit, fetcher } = mockStream()
  const reject = () => Promise.resolve(new Response(JSON.stringify({ code: 'no_active_turn', error: 'No active turn' }), { status: 409 }))
  fetcher.mockImplementationOnce(reject).mockImplementationOnce(reject)
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next' } })
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true }))
  expect(prompts).toEqual([])
  await act(async () => {
    seedChat('steer-chat', [{ ...turn, outcome: 'done' }])
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(prompts).toEqual(['next'])
  await act(async () => { emit({ type: 'done', status: 'idle', session: {} }); pulls[0]!.close() })
})

it('does not retry or queue an ambiguous steering response', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(() => Promise.reject(new TypeError('response lost')))
  vi.stubGlobal('fetch', fetcher)
  seedChat('steer-chat', [{ id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus' } })
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true }))
  await act(async () => vi.advanceTimersByTimeAsync(125000))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Queued:')).toBeTruthy()
})

it('bounds admission waiting without queueing or resending after timeout', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: 'no_active_turn', error: 'No active turn' }), { status: 409 })))
  vi.stubGlobal('fetch', fetcher)
  seedChat('steer-chat', [{ id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus' } })
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true }))
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(toast.error).toHaveBeenCalledOnce()
  expect(screen.queryByText('Steering')).toBeNull()
  const attempts = fetcher.mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(fetcher).toHaveBeenCalledTimes(attempts)
  expect(screen.getByText('Queued:')).toBeTruthy()
})

it('opens the steering chip before the first response and shows only a redacted preview', async () => {
  vi.useFakeTimers()
  let reply: (response: Response) => void = () => { throw new Error('No request') }
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { reply = resolve })))
  seedChat('steer-chat', [{ id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }])
  render(<ChatHarness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus test-secret' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
  expect(screen.getByText('Steering')).toBeTruthy()
  expect(screen.getByText('Sending message…')).toBeTruthy()
  expect(screen.queryByText('Waiting to steer')).toBeNull()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  await act(async () => reply(new Response(JSON.stringify({ code: 'no_active_turn', error: 'No active turn', preview_text: 'focus [redacted]' }), { status: 409 })))
  expect(screen.getByText('focus [redacted]')).toBeTruthy()
  expect(screen.queryByText('focus test-secret')).toBeNull()
  await act(async () => { dropChat('steer-chat'); await vi.advanceTimersByTimeAsync(250) })
  expect(screen.queryByText('Steering')).toBeNull()
})

it('accepts several steering messages before earlier requests finish and keeps every chip', async () => {
  const replies: ((response: Response) => void)[] = []
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => new Promise<Response>((resolve) => replies.push(resolve)))
  vi.stubGlobal('fetch', fetcher)
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  render(<ChatHarness />)
  for (const text of ['change the colors', 'change the heading', 'add a footer']) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  }
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(screen.getAllByText(/^Steering/)).toHaveLength(3)
  expect(screen.getAllByRole('status', { name: 'Steering in progress' })).toHaveLength(3)
  expect(screen.getByText('Queued:')).toBeTruthy()
  const records = fetcher.mock.calls.map(([path, init]) => {
    expect(path).toBe('/api/steer')
    const body = JSON.parse(init!.body as string)
    return { submission_id: body.submission_id as string, text: body.text as string, status: 'posted' as const, by: 'viewer-self', at: Date.now() }
  })
  expect(new Set(records.map((row) => row.submission_id)).size).toBe(3)
  for (const index of [2, 0, 1]) {
    await act(async () => replies[index]!(new Response(JSON.stringify(records[index]))))
    expect(screen.getAllByText(/^Steering/)).toHaveLength(3)
  }
  for (const record of records) expect(screen.getAllByText(record.text)).toHaveLength(1)
  act(() => seedChat('steer-chat', [{ ...turn, outcome: 'done', interjections: records.map((row) => ({ ...row, status: 'confirmed' })) }]))
  expect(screen.queryByText(/^Steering/)).toBeNull()
  expect(screen.queryByRole('status', { name: 'Steering in progress' })).toBeNull()
  for (const record of records) expect(screen.getAllByText(record.text)).toHaveLength(1)
  expect(toast.error).not.toHaveBeenCalled()
})

it('stops every waiting steering message without sending delayed prompts', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn((path: string, init?: RequestInit) => {
    if (path === '/api/cancel') return Promise.resolve(new Response(JSON.stringify({ ok: true })))
    const body = JSON.parse(init!.body as string)
    return Promise.resolve(new Response(JSON.stringify({ code: 'no_active_turn', error: 'No active turn', preview_text: body.text }), { status: 409 }))
  })
  vi.stubGlobal('fetch', fetcher)
  const turn: Turn = { id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }
  seedChat('steer-chat', [turn])
  render(<ChatHarness />)
  for (const text of ['first change', 'second change', 'third change']) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true }))
  }
  expect(screen.getAllByText(/^Steering/)).toHaveLength(3)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop the turn' })))
  expect(screen.queryByText(/^Steering/)).toBeNull()
  await act(async () => {
    seedChat('steer-chat', [{ ...turn, outcome: 'cancelled' }])
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/steer', '/api/steer', '/api/steer', '/api/cancel'])
  expect(screen.getByText('Queued:')).toBeTruthy()
})

it('keeps other steering messages when one request fails', async () => {
  const replies: ((response: Response) => void)[] = []
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => new Promise<Response>((resolve) => replies.push(resolve)))
  vi.stubGlobal('fetch', fetcher)
  seedChat('steer-chat', [{ id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }])
  render(<ChatHarness />)
  for (const text of ['first change', 'second change']) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
  }
  await act(async () => replies[0]!(new Response(JSON.stringify({ error: 'Could not verify turn' }), { status: 502 })))
  expect(screen.getAllByText(/^Steering/)).toHaveLength(1)
  const body = JSON.parse(fetcher.mock.calls[1]![1]!.body as string)
  await act(async () => replies[1]!(new Response(JSON.stringify({ ...body, by: 'viewer-self', at: Date.now(), status: 'posted' }))))
  expect(screen.getAllByText(/^Steering/)).toHaveLength(1)
  expect(screen.getByText('second change')).toBeTruthy()
  expect(toast.error).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('places multiple admitted steering messages between assistant output segments without inline loading indicators', () => {
  const turn: Turn = {
    id: 1, prompt: 'build', phase: null, activities: [], outcome: 'running', text: 'Before 🐶\n\nmiddle\n\nafter',
    interjections: [
      { submission_id: 'inline-1', text: 'first change', status: 'posted', by: 'viewer-self', at: 1, text_offset: 8 },
      { submission_id: 'inline-2', text: 'second change', status: 'sending', by: 'other-viewer', at: 2, text_offset: 16 },
    ],
  }
  const { container, rerender } = render(<><Transcript turns={[turn]} sessionKey="steer-chat" /><SteeringStack turns={[turn]} /></>)
  expect([...container.querySelectorAll('p')].map((node) => node.textContent)).toEqual(['build', 'Before 🐶', 'first change', 'middle', 'Other viewer', 'second change', 'after'])
  expect(screen.queryByRole('status', { name: 'Steering in progress' })).toBeNull()
  expect(screen.queryByText(/^Steering/)).toBeNull()
  const completed: Turn = { ...turn, outcome: 'done', interjections: turn.interjections!.map((row) => ({ ...row, status: 'confirmed' })) }
  rerender(<><Transcript turns={[completed]} sessionKey="steer-chat" /><SteeringStack turns={[completed]} /></>)
  expect([...container.querySelectorAll('p')].map((node) => node.textContent)).toEqual(['build', 'Before 🐶', 'first change', 'middle', 'Other viewer', 'second change', 'after'])
  expect(screen.queryByRole('status', { name: 'Steering in progress' })).toBeNull()
})


it('steers a selected queued card or the queue head with Cmd+Enter without sending either twice', async () => {
  const replies: ((response: Response) => void)[] = []
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => new Promise<Response>((resolve) => replies.push(resolve)))
  vi.stubGlobal('fetch', fetcher)
  seedChat('steer-chat', [{ id: 1, prompt: 'remote', phase: null, text: '', activities: [], outcome: 'running' }])
  render(<ChatHarness />)
  const input = screen.getByRole('textbox')
  for (const text of ['first queued', 'second queued']) {
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.getByText('Queued: first queued, second queued')).toBeTruthy()
  expect(screen.getAllByText('Enter', { selector: 'kbd' })).toHaveLength(2)
  // The stack renders tail first and paints its head last.
  fireEvent.click(screen.getAllByRole('button', { name: 'Steer queued message' })[0]!)
  expect(screen.getByText('Queued: first queued')).toBeTruthy()
  expect(screen.getByRole('status', { name: 'Steering in progress' })).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(screen.getByText('Queued:')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Steer queued message' })).toBeNull()
  expect(screen.getAllByRole('status', { name: 'Steering in progress' })).toHaveLength(2)
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map(([path, init]) => [path, JSON.parse(init!.body as string).text])).toEqual([
    ['/api/steer', 'second queued'], ['/api/steer', 'first queued'],
  ])
  for (const [index, [, init]] of fetcher.mock.calls.entries()) {
    await act(async () => replies[index]!(new Response(JSON.stringify({ ...JSON.parse(init!.body as string), by: 'viewer-self', at: 1, status: 'posted' }))))
  }
  expect(screen.getByText('Queued:')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
