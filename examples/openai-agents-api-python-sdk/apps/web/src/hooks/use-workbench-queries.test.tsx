import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchHealth, fetchStatus } from '@/api/client'
import { useWorkbenchQueries } from '@/hooks/use-workbench-queries'

vi.mock('@/api/client', () => ({
  fetchHealth: vi.fn(),
  fetchStatus: vi.fn(),
  fetchFiles: vi.fn(),
  getClientId: () => 'test-client',
}))
vi.mock('@/lib/wake-toast', () => ({ announceSandboxWake: vi.fn() }))
afterEach(cleanup)

it('clears the host-key warning from the save response while status is still stale', async () => {
  const missing = {
    has_e2b_key: false,
    has_openai_key: false,
    has_executor_key: false,
    ok: true,
  } as Awaited<ReturnType<typeof fetchHealth>>
  vi.mocked(fetchHealth).mockResolvedValue(missing)
  vi.mocked(fetchStatus).mockResolvedValue({
    connected: false,
    env_key_available: false,
  } as Awaited<ReturnType<typeof fetchStatus>>)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result, unmount } = renderHook(() => useWorkbenchQueries('chat', false, false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  await waitFor(() => expect(result.current.hostKeyMissing).toBe(true))
  await waitFor(() => expect(result.current.snapshot?.env_key_available).toBe(false))
  expect(result.current.hasKeys).toBe(false)

  act(() => client.setQueryData(['health'], {
    ...missing,
    has_e2b_key: true,
  }))
  await waitFor(() => expect(result.current.hasKeys).toBe(true))
  expect(result.current.keysMissing).toBe(true)

  act(() => client.setQueryData(['health'], {
    ...missing,
    has_e2b_key: true,
    has_openai_key: true,
  }))
  await waitFor(() => expect(result.current.hostKeyMissing).toBe(false))
  expect(result.current.keysMissing).toBe(false)
  expect(result.current.hasKeys).toBe(true)
  expect(result.current.snapshot?.env_key_available).toBe(false)
  unmount()
  client.clear()
})
