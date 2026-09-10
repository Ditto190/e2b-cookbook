// In-memory view of the coordinator archive. Browser storage is read only
// for one-time migration; all new transcript writes happen in the backend.
import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchChatArchive, importChatArchive } from '@/api/client'
import type { components } from '@/api/schema'
import type { Turn } from '@/lib/chat-store'

export type ArchivedSession = components['schemas']['ArchivedChat']

// Legacy keys are removed only after the coordinator accepts their archive.
const STORAGE_KEY = 'agents-api-workbench-chats:v1'
// Pre-versioning key — read once as a fallback so existing archives survive.
const LEGACY_STORAGE_KEY = 'agents-api-workbench-chats'
const CURRENT_KEY = 'agents-api-workbench-current-chat'

function load(): ArchivedSession[] {
  const raw =
    localStorage.getItem(STORAGE_KEY) ??
    localStorage.getItem(LEGACY_STORAGE_KEY)
  const parsed = raw ? (JSON.parse(raw) as ArchivedSession[]) : []
  if (!Array.isArray(parsed))
    throw new Error('The saved browser archive is invalid.')
  return parsed
}

let cache: ArchivedSession[] = []
const listeners = new Set<() => void>()

function publish(next: ArchivedSession[]) {
  cache = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let migration: Promise<void> | undefined

async function loadSharedArchive() {
  migration ??= (async () => {
    const legacy = load()
    if (legacy.length) await importChatArchive(legacy)
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  })().catch((error) => {
    migration = undefined
    throw error
  })
  await migration
  return (await fetchChatArchive()).chats
}

export function useSessionArchive() {
  const query = useQuery({
    queryKey: ['chat-archive'],
    queryFn: loadSharedArchive,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  })
  useEffect(() => {
    if (query.data) publish(query.data)
  }, [query.data])
  const sessions = useSyncExternalStore(subscribe, () => cache)
  return {
    sessions,
    ready: query.data !== undefined,
    error: query.error,
    retry: query.refetch,
  }
}

export function receiveSession(record: ArchivedSession) {
  publish([record, ...cache.filter((session) => session.id !== record.id)])
}

export function getSession(id: string): ArchivedSession | undefined {
  return cache.find((session) => session.id === id)
}

/** Mirror the live transcript into the archive (called on every turn change). */
export function upsertSession(id: string, turns: Turn[]) {
  const first = turns[0]
  if (!first) {
    return
  }
  const existing = getSession(id)
  const record: ArchivedSession = {
    ...existing,
    id,
    title: existing?.title ?? first.prompt.slice(0, 80),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    turns,
  }
  // In-place update — list order only changes when a turn message is SENT
  // (bumpSession) or a brand-new chat appears, never mid-stream.
  publish(
    existing
      ? cache.map((session) => (session.id === id ? record : session))
      : [record, ...cache]
  )
}

/** Move a chat to the top of the list — called when a turn message is sent. */
export function bumpSession(id: string) {
  const session = getSession(id)
  if (!session || cache[0]?.id === id) {
    return
  }
  publish([session, ...cache.filter((other) => other.id !== id)])
}

/** Attach backend identities (sandbox/session/parent ids) for the sidebar.
 * `undefined` fields are left untouched — only `null` explicitly clears. */
export function setSessionMeta(
  id: string,
  meta: {
    sandboxId?: string | null
    sessionId?: string | null
    parentChatId?: string | null
    capabilities?: ArchivedSession['capabilities']
  }
) {
  const session = getSession(id)
  if (!session) {
    return
  }
  const next: ArchivedSession = {
    ...session,
    capabilities: meta.capabilities ?? session.capabilities,
    sandboxId:
      meta.sandboxId === undefined ? session.sandboxId : meta.sandboxId,
    sessionId:
      meta.sessionId === undefined ? session.sessionId : meta.sessionId,
    parentChatId:
      meta.parentChatId === undefined
        ? session.parentChatId
        : meta.parentChatId,
  }
  if (
    session.capabilities === next.capabilities &&
    session.sandboxId === next.sandboxId &&
    session.sessionId === next.sessionId &&
    session.parentChatId === next.parentChatId
  ) {
    return
  }
  publish(cache.map((other) => (other.id === id ? next : other)))
}

export function markSessionExpired(id: string, forkable = false) {
  const existing = getSession(id)
  if (!existing || (existing.expired && existing.forkable === forkable)) {
    return
  }
  publish(
    cache.map((session) =>
      session.id === id ? { ...session, expired: true, forkable } : session
    )
  )
}

export function removeSession(id: string) {
  publish(cache.filter((session) => session.id !== id))
}

export function newSessionId(): string {
  // Bare 8-hex id (?chat=76ca9c4b) — the chat's permanent identity.
  const id = crypto.randomUUID().slice(0, 8)
  localStorage.setItem(CURRENT_KEY, id)
  return id
}

/** The last-viewed chat id — the default view after a reload. Pure (no
 * localStorage write): it runs as a useState lazy initializer, i.e. during
 * render, where side effects would break the compiler's purity assumptions.
 * Persistence happens post-mount via the setCurrentChat(viewId) effect. */
export function currentSessionId(): string {
  return localStorage.getItem(CURRENT_KEY) ?? crypto.randomUUID().slice(0, 8)
}

export function setCurrentChat(id: string) {
  localStorage.setItem(CURRENT_KEY, id)
}
