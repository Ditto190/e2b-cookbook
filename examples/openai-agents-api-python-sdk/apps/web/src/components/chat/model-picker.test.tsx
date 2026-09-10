// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setAgentSettings, useAgentSettings } from '@/lib/agent-settings'
import { ModelSelector } from './model-selector'

vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  fetchModels: async () => ({ models: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-luna' }] }),
}))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })

function Picker() {
  const draft = useAgentSettings()
  return <ModelSelector draft={draft} onChange={setAgentSettings} />
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><Picker /></QueryClientProvider>)
}

const trigger = () => screen.getByRole('combobox', { name: 'Model and agent settings' })
const listbox = () => screen.getByRole('listbox')
const section = (name: string) => within(screen.getByRole('group', { name }))
const searchBox = () => screen.getByRole('combobox', { name: 'Search settings' })

beforeEach(() => {
  setAgentSettings({ model: 'gpt-5.6-sol', reasoningEffort: null, textVerbosity: null, serviceTier: null })
})
afterEach(() => cleanup())

it('opens one popup with a model section plus effort, verbosity and tier', async () => {
  renderPicker()
  fireEvent.click(trigger())
  const list = await screen.findByRole('listbox')
  for (const group of ['Model', 'Effort', 'Verbosity', 'Tier']) {
    expect(within(list).getByText(group)).toBeTruthy()
  }
  await waitFor(() => expect(within(list).getByText('GPT-5.6 Luna')).toBeTruthy())
  expect(section('Effort').getByText('xhigh')).toBeTruthy()
  expect(section('Tier').getByText('priority')).toBeTruthy()
})

it('applies a row to the draft, keeps the popup open and summarizes on the pill', async () => {
  renderPicker()
  fireEvent.click(trigger())
  await screen.findByRole('listbox')
  fireEvent.click(section('Effort').getByText('high'))
  expect(useSettings().reasoningEffort).toBe('high')
  // Still open: the other knobs can be tuned in the same pass.
  fireEvent.click(section('Tier').getByText('flex'))
  expect(useSettings().serviceTier).toBe('flex')
  expect(screen.getByTestId('tuned-summary').textContent).toBe('· high · flex')
  fireEvent.click(section('Model').getByText('GPT-5.6 Luna'))
  expect(useSettings().model).toBe('gpt-5.6-luna')
  expect(trigger().textContent).toContain('GPT-5.6 Luna')
})

it('filters rows across sections by section name, label or hint', async () => {
  renderPicker()
  fireEvent.click(trigger())
  await screen.findByRole('listbox')
  fireEvent.change(searchBox(), { target: { value: 'cheaper' } })
  expect(within(listbox()).getByText('flex')).toBeTruthy()
  expect(within(listbox()).queryByText('high')).toBeNull()
  fireEvent.change(searchBox(), { target: { value: 'verbo' } })
  expect(within(listbox()).getAllByRole('option')).toHaveLength(4)
  fireEvent.change(searchBox(), { target: { value: 'zzz' } })
  expect(screen.getByText('No match.')).toBeTruthy()
})

function useSettings() {
  let snapshot: ReturnType<typeof useAgentSettings> | undefined
  function Probe() { snapshot = useAgentSettings(); return null }
  const { unmount } = render(<Probe />)
  unmount()
  return snapshot!
}
