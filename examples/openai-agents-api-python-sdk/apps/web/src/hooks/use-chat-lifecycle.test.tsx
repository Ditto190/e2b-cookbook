import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@/api/client'
import { useChatLifecycle } from '@/hooks/use-chat-lifecycle'
import { getSession, removeSession, upsertSession } from '@/lib/sessions'

const { postFork, postReset } = vi.hoisted(() => ({
  postFork: vi.fn(),
  postReset: vi.fn(() => Promise.resolve({ ok: true })),
}))

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  getClientId: () => 'test-client-id',
  postFork,
  postReset,
}))

vi.mock('@/lib/wake-toast', () => ({
  announceSandboxWake: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  removeSession('failed-chat')
  removeSession('recovered-chat')
  postFork.mockReset()
  postReset.mockClear()
})

describe('useChatLifecycle', () => {
  it('attaches the recovered sandbox in the UI before selecting its chat', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const chat: SessionSnapshot = {
      chat_id: 'recovered-chat',
      connected: true,
      paused: false,
      session_id: 'session-recovered',
      environment_id: null,
      executor_pid: 123,
      active: false,
      cancel_ready: false,
      sandbox: 'sandbox-recovered',
      workspace: '/workspace',
      model: 'test-model',
      reasoning_effort: null,
      verbosity: null,
      service_tier: null,
      agent_locked: true,
      env_key_available: true,
      timeout_at: null,
      terminal_reason: null,
      parent_chat_id: null,
    }
    const archive = {
      id: 'recovered-chat',
      title: 'Server transcript',
      createdAt: 1,
      updatedAt: 2,
      turns: [
        {
          id: 1,
          prompt: 'Shared prompt',
          text: 'Saved on coordinator',
          phase: null,
          activities: [],
          outcome: 'done',
        },
      ],
      parentChatId: null,
      sandboxId: 'sandbox-recovered',
      sessionId: 'session-recovered',
    }
    postFork.mockResolvedValue({ chat, archive })
    upsertSession('failed-chat', [
      {
        id: 1,
        prompt: 'continue',
        phase: null,
        activities: [],
        text: '',
        outcome: 'error',
        error: 'decayed',
      },
    ])
    const setViewId = vi.fn((id: string) => {
      expect(queryClient.getQueryData(['status', id])).toEqual(chat)
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useChatLifecycle('failed-chat', setViewId),
      { wrapper }
    )

    act(() => {
      result.current.forkMutation.mutate({ id: 'failed-chat', sibling: true })
    })

    await waitFor(() =>
      expect(setViewId).toHaveBeenCalledWith('recovered-chat')
    )
    expect(queryClient.getQueryData(['status', 'recovered-chat'])).toEqual(chat)
    expect(getSession('recovered-chat')).toEqual(archive)
  })
})
