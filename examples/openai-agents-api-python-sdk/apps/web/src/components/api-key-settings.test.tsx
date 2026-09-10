import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealth, postKeys } from '@/api/client'
import { ApiKeyPanel, ApiKeySettings, ApiKeySettingsProvider } from '@/components/api-key-settings'

vi.mock('@/api/client', () => ({
  fetchHealth: vi.fn(),
  postKeys: vi.fn(),
}))
vi.mock('@/lib/chat-store', () => ({ sendChatPrompt: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('API key settings', () => {
  it('prevents dismissal without keys and allows it once a key is configured', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({
      ok: true,
      has_e2b_key: false,
      has_openai_key: false,
      has_executor_key: false,
    } as Awaited<ReturnType<typeof fetchHealth>>)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const settings = (hasKeys: boolean) => (
      <QueryClientProvider client={client}>
        <ApiKeySettingsProvider keysMissing hasKeys={hasKeys}>
          <ApiKeySettings />
          <ApiKeyPanel keysMissing />
          <button>Outside</button>
        </ApiKeySettingsProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(settings(false))
    const input = await screen.findByLabelText('E2B API key')
    expect(screen.queryByRole('button', { name: 'Close API key settings' })).toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'API key settings' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    fireEvent.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.getByRole('dialog')).toBeTruthy()

    rerender(settings(true))
    fireEvent.click(screen.getByRole('button', { name: 'Close API key settings' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'API key settings' }))
    fireEvent.keyDown(await screen.findByLabelText('E2B API key'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    rerender(settings(false))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    client.clear()
  })

  it('reopens configured keys, saves only replacements, and resets secrets on close', async () => {
    const health = {
      ok: true,
      has_e2b_key: true,
      has_openai_key: true,
      has_executor_key: true,
    } as Awaited<ReturnType<typeof fetchHealth>>
    vi.mocked(fetchHealth).mockResolvedValue(health)
    vi.mocked(postKeys).mockResolvedValue(health)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ApiKeySettingsProvider keysMissing={false} hasKeys><ApiKeySettings /><ApiKeyPanel keysMissing={false} /></ApiKeySettingsProvider></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'API key settings' }))
    const dialog = within(await screen.findByRole('dialog'))
    const e2b = await dialog.findByLabelText('E2B API key') as HTMLInputElement
    const openai = dialog.getByLabelText('OpenAI API key (Agents API preview)') as HTMLInputElement
    expect(e2b.value).toBe('')
    expect((dialog.getByRole('button', { name: 'Save keys' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(e2b, { target: { value: ' e2b-test-replacement ' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Show E2B API key' }))
    expect(e2b.type).toBe('text')
    expect(openai.type).toBe('password')
    expect(postKeys).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Hide E2B API key' }))
    expect(e2b.type).toBe('password')
    fireEvent.click(dialog.getByRole('button', { name: 'Save keys' }))
    await waitFor(() => expect(postKeys).toHaveBeenCalledWith({ e2b_api_key: 'e2b-test-replacement' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'API key settings' }))
    const reopened = within(await screen.findByRole('dialog'))
    const input = await reopened.findByLabelText('E2B API key') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'unsaved-secret' } })
    fireEvent.click(reopened.getByRole('button', { name: 'Show E2B API key' }))
    fireEvent.click(reopened.getByRole('button', { name: 'Close API key settings' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'API key settings' }))
    const reset = await within(await screen.findByRole('dialog')).findByLabelText('E2B API key') as HTMLInputElement
    expect(reset.value).toBe('')
    expect(reset.type).toBe('password')
    client.clear()
  })
})
