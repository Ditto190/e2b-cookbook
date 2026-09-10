import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LogRecordEvent } from '@/api/client'
import { appendLog, clearLogs, useLogs } from './log-store'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function record(seq: number, streamId = 'stream'): LogRecordEvent {
  return {
    type: 'log', stream_id: streamId, cursor: seq, seq,
    at: '2026-09-05T08:00:00Z', source: 'backend', stream: 'stderr',
    text: `line ${seq}`,
  }
}

it('batches updates without mutating previously rendered snapshots', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  const { result } = renderHook(() => useLogs('snapshot-test'))
  appendLog('snapshot-test', record(1))
  appendLog('snapshot-test', record(2))
  expect(frames).toHaveLength(1)
  expect(result.current).toHaveLength(0)
  act(() => frames.shift()!(0))
  const previous = result.current
  appendLog('snapshot-test', record(3))
  act(() => frames.shift()!(0))
  expect(previous.map((r) => r.seq)).toEqual([1, 2])
  expect(result.current.map((r) => r.seq)).toEqual([1, 2, 3])
})

it('keeps the latest logs across long background bursts, clears, and restarts', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  const { result } = renderHook(() => useLogs('burst-test'))
  for (let seq = 1; seq <= 150_000; seq++) appendLog('burst-test', record(seq))
  expect(frames).toHaveLength(1)
  act(() => frames.shift()!(0))
  expect(result.current).toHaveLength(5000)
  expect(result.current[0]?.seq).toBe(145_001)
  const previous = result.current
  appendLog('burst-test', record(150_001))
  act(() => frames.shift()!(0))
  expect(result.current).toHaveLength(5000)
  expect(result.current.at(-1)?.seq).toBe(150_001)
  expect(previous.at(-1)?.seq).toBe(150_000)
  act(() => clearLogs('burst-test'))
  appendLog('burst-test', record(150_001))
  expect(frames).toHaveLength(0)
  appendLog('burst-test', record(1, 'restarted'))
  act(() => frames.shift()!(0))
  expect(result.current.map((r) => r.seq)).toEqual([1])
})
