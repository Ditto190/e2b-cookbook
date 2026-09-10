import type { LogRecordEvent } from '@/api/client'
import { useSyncExternalStore } from 'react'

const MAX_LOG_RECORDS = 5000

type LogStore = {
  records: LogRecordEvent[]
  pending: LogRecordEvent[]
  listeners: Set<() => void>
  frame: number | null
  lastSeq: number
  streamId: string | null
}

const stores = new Map<string, LogStore>()

function getStore(chatId: string): LogStore {
  let store = stores.get(chatId)
  if (!store) {
    const records: LogRecordEvent[] = []
    store = {
      records,
      pending: [],
      listeners: new Set(),
      frame: null,
      lastSeq: 0,
      streamId: null,
    }
    stores.set(chatId, store)
  }
  return store
}

function flush(chatId: string) {
  const store = getStore(chatId)
  store.frame = null
  if (store.pending.length === 0) return
  store.records = [...store.records, ...store.pending].slice(-MAX_LOG_RECORDS)
  store.pending = []
  for (const listener of store.listeners) listener()
}

/** Batch noisy streams to one React notification per animation frame. */
export function appendLog(chatId: string, record: LogRecordEvent) {
  const store = getStore(chatId)
  if (store.streamId !== record.stream_id) {
    store.records = []
    store.pending = []
    store.lastSeq = 0
    store.streamId = record.stream_id
  }
  if (record.seq <= store.lastSeq) return
  store.lastSeq = record.seq
  store.pending.push(record)
  // Animation frames pause in background tabs; bound the backlog there too.
  if (store.pending.length >= MAX_LOG_RECORDS * 2) {
    store.pending.splice(0, MAX_LOG_RECORDS)
  }
  if (store.frame === null) {
    store.frame = requestAnimationFrame(() => flush(chatId))
  }
}

export function clearLogs(chatId: string) {
  const store = getStore(chatId)
  store.records = []
  store.pending = []
  for (const listener of store.listeners) listener()
}

export function useLogs(chatId: string): LogRecordEvent[] {
  const store = getStore(chatId)
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    () => store.records,
    () => store.records
  )
}
