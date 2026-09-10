import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppSidebar } from '@/components/app-sidebar'
import {
  dropChat, seedChat, sendChatPrompt, setViewedChat, syncSharedChats,
  useActiveChatIds, useChatState, useUnseenChatIds,
} from '@/lib/chat-store'
import type { ArchivedSession } from '@/lib/sessions'

const { streamChat } = vi.hoisted(() => ({ streamChat: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()), streamChat,
}))
vi.mock('@/lib/settings', () => ({ getAutoPause: () => false }))

const chat: ArchivedSession = {
  id: 'remote12', title: 'Shared chat', createdAt: 1, updatedAt: 2,
  turns: [{ id: 1, prompt: 'Build a page', text: '', phase: 'Starting agent', activities: [], outcome: 'running' }],
}
const completed: ArchivedSession = {
  ...chat,
  turns: [{ id: 1, prompt: 'Build a page', text: 'Built the page', phase: null, activities: [], outcome: 'done' }],
}
function Sidebar() {
  const activeIds = useActiveChatIds()
  const unseenIds = useUnseenChatIds()
  return <AppSidebar sessions={[chat]} viewId="viewed12" activeIds={activeIds} unseenIds={unseenIds}
    forkingId={null} onNew={vi.fn()} onSelect={vi.fn()} onFork={vi.fn()} onPromote={vi.fn()} onDelete={vi.fn()} />
}

beforeEach(() => {
  streamChat.mockReset()
  setViewedChat('viewed12')
})
afterEach(() => {
  cleanup()
  dropChat(chat.id)
})

it('shows remote work and its completed response in an unselected sidebar row', () => {
  render(<QueryClientProvider client={new QueryClient()}><Sidebar /></QueryClientProvider>)
  act(() => syncSharedChats([chat]))
  expect(screen.getByRole('status', { name: 'Agent working' })).toBeTruthy()
  expect(screen.getByText(/streaming/)).toBeTruthy()
  act(() => syncSharedChats([completed]))
  expect(screen.queryByRole('status', { name: 'Agent working' })).toBeNull()
  expect(screen.getByRole('status', { name: 'New response' })).toBeTruthy()
  act(() => setViewedChat(chat.id))
  expect(screen.queryByRole('status', { name: 'New response' })).toBeNull()
  act(() => { setViewedChat('viewed12'); syncSharedChats([structuredClone(completed)]) })
  expect(screen.queryByRole('status', { name: 'New response' })).toBeNull()
})

it('shows completed history to a new viewer even when the running poll was missed', () => {
  render(<QueryClientProvider client={new QueryClient()}><Sidebar /></QueryClientProvider>)
  act(() => syncSharedChats([completed]))
  expect(screen.getByRole('status', { name: 'New response' })).toBeTruthy()
})

it('updates the viewed chat phase, busy controls, and final output from shared history', () => {
  setViewedChat(chat.id)
  const result = renderHook(() => ({ state: useChatState(chat.id), unseen: useUnseenChatIds() }))
  act(() => syncSharedChats([chat]))
  expect(result.result.current.state.active).toBe(true)
  expect(result.result.current.state.turns[0]?.phase).toBe('Starting agent')
  act(() => syncSharedChats([completed]))
  expect(result.result.current.state.active).toBe(false)
  expect(result.result.current.state.turns[0]?.text).toBe('Built the page')
  expect(result.result.current.unseen).toBe('')
})

it('sends a queued follow-up once after a remote turn finishes, without losing history', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  streamChat.mockImplementation(async function* () { await pending; yield { type: 'cancelled' } })
  const result = renderHook(() => useChatState(chat.id))
  act(() => { syncSharedChats([chat]); sendChatPrompt(chat.id, 'Add a footer') })
  expect(streamChat).not.toHaveBeenCalled()
  expect(result.result.current.queued).toEqual(['Add a footer'])
  act(() => syncSharedChats([completed]))
  expect(streamChat).toHaveBeenCalledTimes(1)
  expect(result.result.current.queued).toEqual([])
  expect(result.result.current.turns[0]?.text).toBe('Built the page')
  expect(result.result.current.turns.at(-1)?.prompt).toBe('Add a footer')
  act(() => syncSharedChats([completed]))
  expect(streamChat).toHaveBeenCalledTimes(1)
  expect(result.result.current.active).toBe(true)
  await act(async () => { finish(); await pending })
  await waitFor(() => expect(result.result.current.active).toBe(false))
})

it('keeps queued prompts parked when the remote turn errors', () => {
  const result = renderHook(() => useChatState(chat.id))
  act(() => { seedChat(chat.id, chat.turns); sendChatPrompt(chat.id, 'Continue') })
  act(() => seedChat(chat.id, completed.turns.map((turn) => ({ ...turn, outcome: 'error', error: 'Failed' }))))
  expect(result.result.current.active).toBe(false)
  expect(result.result.current.queued).toEqual(['Continue'])
  expect(streamChat).not.toHaveBeenCalled()
})
