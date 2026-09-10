import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppSidebar } from '@/components/app-sidebar'

const entry = {
  id: 'memory-one', text: 'Prefers concise answers', tags: ['preferences'],
  source_chat_id: 'source-chat', created_at: '2026-09-10T10:00:00+00:00',
}

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <AppSidebar sessions={[]} viewId="draft" activeIds="" unseenIds="" forkingId={null}
      onNew={vi.fn()} onSelect={vi.fn()} onFork={vi.fn()} onPromote={vi.fn()} onDelete={vi.fn()} />
  </QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('lists shared memories with time and source chat in the sidebar and deletes an entry', async () => {
  let entries = [entry]
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      entries = []
      return Response.json({ ok: true })
    }
    return Response.json({ entries })
  })
  vi.stubGlobal('fetch', fetch)
  renderSidebar()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Shared memory' }))
  expect(screen.getByText('Shared with everyone on this workbench')).toBeTruthy()
  const text = await screen.findByText(entry.text)
  expect(screen.getByText('Source chat: source-chat')).toBeTruthy()
  expect(text.closest('li')?.querySelector('time')?.getAttribute('datetime')).toBe(entry.created_at)
  fireEvent.click(screen.getByRole('button', { name: `Delete memory: ${entry.text}` }))
  await screen.findByText('No shared memories yet.')
  expect(fetch).toHaveBeenCalledWith('/api/memories/memory-one', { method: 'DELETE' })
})

it('keeps an entry visible and reports a failed delete', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'DELETE'
      ? Response.json({ error: 'Delete failed.' }, { status: 500 })
      : Response.json({ entries: [entry] })
  ))
  renderSidebar()
  fireEvent.click(screen.getByRole('button', { name: 'Shared memory' }))
  await screen.findByText(entry.text)
  fireEvent.click(screen.getByRole('button', { name: `Delete memory: ${entry.text}` }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Delete failed.'))
  expect(screen.getByText(entry.text)).toBeTruthy()
})
