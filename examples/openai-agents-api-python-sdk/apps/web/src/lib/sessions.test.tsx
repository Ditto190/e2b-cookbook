import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSessionArchive, type ArchivedSession } from '@/lib/sessions'
import {
  dropChat,
  seedChat,
  sendChatPrompt,
  useChatState,
} from '@/lib/chat-store'

const { fetchChatArchive, importChatArchive, streamChat } = vi.hoisted(() => ({
  fetchChatArchive: vi.fn(),
  importChatArchive: vi.fn(),
  streamChat: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchChatArchive,
  importChatArchive,
  streamChat,
}))
vi.mock('@/lib/settings', () => ({ getAutoPause: () => false }))

const legacyKey = 'agents-api-workbench-chats:v1'
const record: ArchivedSession = {
  id: 'shared12',
  title: 'Shared chat',
  createdAt: 1,
  updatedAt: 2,
  turns: [
    {
      id: 1,
      prompt: 'Original prompt',
      text: 'Server answer',
      phase: null,
      activities: [],
      outcome: 'done',
    },
  ],
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
let client: QueryClient

afterEach(() => {
  cleanup()
  client?.clear()
  localStorage.clear()
  dropChat(record.id)
})

it('retains a failed migration, retries it, then loads server history in a fresh browser', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  localStorage.setItem(legacyKey, JSON.stringify([record]))
  importChatArchive.mockRejectedValueOnce(new Error('Offline'))
  fetchChatArchive.mockResolvedValue({ chats: [record] })
  const first = renderHook(useSessionArchive, { wrapper })
  await waitFor(() =>
    expect(first.result.current.error?.message).toBe('Offline')
  )
  expect(first.result.current.ready).toBe(false)
  expect(localStorage.getItem(legacyKey)).not.toBeNull()
  expect(fetchChatArchive).not.toHaveBeenCalled()

  importChatArchive.mockResolvedValue({ ok: true })
  await act(async () => {
    await first.result.current.retry()
  })
  await waitFor(() => expect(first.result.current.sessions).toEqual([record]))
  expect(first.result.current.ready).toBe(true)
  expect(localStorage.getItem(legacyKey)).toBeNull()
  expect(importChatArchive).toHaveBeenLastCalledWith([record])

  first.unmount()
  client.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  localStorage.clear()
  const latest = { ...record, title: 'Updated by another browser' }
  fetchChatArchive.mockResolvedValue({ chats: [latest] })
  const second = renderHook(useSessionArchive, { wrapper })
  await waitFor(() => expect(second.result.current.sessions).toEqual([latest]))
  expect(localStorage.getItem(legacyKey)).toBeNull()
  expect(importChatArchive).toHaveBeenCalledTimes(2)
})

it('refreshes shared transcripts while protecting a locally streaming turn', async () => {
  const turn = record.turns[0]
  if (!turn) throw new Error('Missing test turn')
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  streamChat.mockImplementation(async function* () {
    await pending
    yield { type: 'cancelled' }
  })
  const state = renderHook(() => useChatState(record.id))
  act(() => seedChat(record.id, record.turns))
  expect(state.result.current.turns[0]?.text).toBe('Server answer')
  act(() => sendChatPrompt(record.id, 'Next local prompt'))
  act(() => seedChat(record.id, [{ ...turn, text: 'Stale poll' }]))
  expect(state.result.current.active).toBe(true)
  expect(state.result.current.turns.at(-1)?.prompt).toBe('Next local prompt')
  await act(async () => {
    finish()
    await pending
  })
  await waitFor(() => expect(state.result.current.active).toBe(false))
  act(() =>
    seedChat(record.id, [{ ...turn, text: 'New shared answer' }])
  )
  expect(state.result.current.turns[0]?.text).toBe('New shared answer')
})
