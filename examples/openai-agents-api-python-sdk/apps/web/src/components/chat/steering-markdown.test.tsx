import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Transcript } from '@/components/chat/transcript'
import type { Turn } from '@/lib/chat-store'

vi.mock('@/api/client', async (original) => ({ ...(await original<typeof import('@/api/client')>()), getClientId: () => 'self' }))
vi.mock('@/lib/settings', () => ({ useShowActivity: () => false }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps fenced code intact when steering arrives inside the code block', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = vi.fn()
  const turn: Turn = {
    id: 1, prompt: 'build', phase: null, activities: [], outcome: 'done',
    text: 'Before\n\n```js\nconst first = 1;\nconst second = 2;\n```\n\nAfter',
    interjections: [{ submission_id: 's1', text: 'use blue', by: 'self', at: 1, status: 'confirmed', text_offset: 31 }],
  }
  const { container } = render(<Transcript turns={[turn]} />)
  await waitFor(() => expect(container.querySelector('pre')?.textContent).toContain('const second = 2;'))
  expect(container.querySelectorAll('pre')).toHaveLength(1)
  expect(container.querySelector('pre')?.textContent).toContain('const first = 1;')
  expect(screen.getByText('After')).toBeTruthy()
  const text = container.textContent!
  expect(text.indexOf('const second')).toBeLessThan(text.indexOf('use blue'))
  expect(text.indexOf('use blue')).toBeLessThan(text.indexOf('After'))
})


it('preserves formatted blocks as output continues after a pending steering message', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = vi.fn()
  const turn: Turn = {
    id: 1, prompt: 'build', phase: null, activities: [], outcome: 'running',
    text: 'Before\n\n- **First**\n- [Second](https://example.com)',
    interjections: [{ submission_id: 's1', text: 'use blue', by: 'self', at: 1, status: 'posted', text_offset: 14 }],
  }
  const { container, rerender } = render(<Transcript turns={[turn]} />)
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(container.querySelector('[data-streamdown=strong]')?.textContent).toBe('First')
  expect(screen.queryByRole('status', { name: 'Steering in progress' })).toBeNull()
  rerender(<Transcript turns={[{ ...turn, text: turn.text + '\n\nAfter', outcome: 'done', interjections: turn.interjections!.map((row) => ({ ...row, status: 'confirmed' })) }]} />)
  await waitFor(() => expect(screen.getByText('After')).toBeTruthy())
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Second' }).getAttribute('data-streamdown')).toBe('link')
  expect(screen.queryByRole('status', { name: 'Steering in progress' })).toBeNull()
  const text = container.textContent!
  expect(text.indexOf('Second')).toBeLessThan(text.indexOf('use blue'))
  expect(text.indexOf('use blue')).toBeLessThan(text.indexOf('After'))
})

it('places steering before later output when Markdown uses CRLF line endings', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = vi.fn()
  const turn: Turn = {
    id: 1, prompt: 'build', phase: null, activities: [], outcome: 'done',
    text: 'Hello\r\n\r\nWorld',
    interjections: [{ submission_id: 's1', text: 'use blue', by: 'self', at: 1, status: 'confirmed', text_offset: 9 }],
  }
  const { container } = render(<Transcript turns={[turn]} />)
  expect([...container.querySelectorAll('p')].map((node) => node.textContent)).toEqual(['build', 'Hello', 'use blue', 'World'])
})
