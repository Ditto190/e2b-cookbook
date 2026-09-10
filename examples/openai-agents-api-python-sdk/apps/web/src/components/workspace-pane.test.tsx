import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePane } from '@/components/workspace-pane'

const { fetchFile } = vi.hoisted(() => ({
  fetchFile: vi.fn(() => new Promise<never>(() => undefined)),
}))

vi.mock('@/api/client', () => ({
  fetchFile,
  fetchFiles: vi.fn(),
  getClientId: () => 'test-client-id',
  uploadFiles: vi.fn(),
}))

vi.mock('@/components/file-preview', () => ({
  FilePreview: ({ path, loading }: { path: string; loading: boolean }) => (
    <p>{loading ? `Loading ${path}` : path}</p>
  ),
}))

vi.mock('@/components/log-viewer', () => ({
  LogViewer: () => null,
}))

afterEach(() => {
  cleanup()
  fetchFile.mockClear()
})

describe('WorkspacePane', () => {
  it('shows the selected chat workspace immediately after switching chats', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    })

    queryClient.setQueryData(['files', 'chat-a'], {
      workspace: '/workspace',
      files: [
        {
          path: 'alpha.py',
          kind: 'file',
          size: 10,
          modified: 1,
        },
      ],
    })
    queryClient.setQueryData(['files', 'chat-b'], {
      workspace: '/workspace',
      files: [],
    })

    const pane = (chatId: string, connected: boolean) => (
      <QueryClientProvider client={queryClient}>
        <WorkspacePane
          active={false}
          chatId={chatId}
          connected={connected}
          logsAvailable={false}
        />
      </QueryClientProvider>
    )

    const { rerender } = render(pane('chat-a', true))

    fireEvent.click(screen.getByRole('button', { name: /alpha\.py/i }))
    expect(queryClient.getQueryData(['workspace-pane', 'chat-a'])).toEqual({
      selectedPath: 'alpha.py',
      showLogs: false,
    })
    expect(await screen.findByText('Loading alpha.py')).toBeTruthy()

    rerender(pane('chat-b', false))

    expect(
      screen.getByText(
        'The workspace appears here once the first turn creates a sandbox.'
      )
    ).toBeTruthy()
    expect(screen.queryByText('Loading alpha.py')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Back to the file list' })
    ).toBeNull()
    expect(fetchFile).not.toHaveBeenCalledWith(
      'test-client-id',
      'chat-b',
      'alpha.py'
    )
    expect(queryClient.getQueryData(['workspace-pane', 'chat-b'])).toEqual({
      selectedPath: null,
      showLogs: false,
    })

    rerender(pane('chat-a', true))

    expect(await screen.findByText('Loading alpha.py')).toBeTruthy()
  })
})
