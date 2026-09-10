import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchFiles, fetchHealth, fetchStatus, getClientId } from '@/api/client'
import { announceSandboxWake } from '@/lib/wake-toast'

const clientId = getClientId()

// The workbench's read-side queries, all keyed to the VIEWED chat: the status
// snapshot behind the lifecycle pill, the workspace file list feeding the
// composer's "@" mention picker, and the key-gate health check.
export function useWorkbenchQueries(
  viewId: string,
  active: boolean,
  /** A resume for the viewed chat is in flight — drives the fast wake poll. */
  resumePending: boolean
) {
  const queryClient = useQueryClient()

  // Status (and the workspace sidecar) follow the VIEWED chat, so switching
  // chats switches the chips and the file tree with it.
  const statusQuery = useQuery({
    queryKey: ['status', viewId],
    queryFn: () => fetchStatus(clientId, viewId),
    // Wake window (a resume in flight, or an active turn on a not-yet-
    // connected sandbox): poll fast so the wake toast lands the moment the
    // backend records it, not up to 5–15s later. Cheap — the disconnected
    // status path is an in-memory read, no sandbox get_info RPC.
    refetchInterval: (query) => {
      const connected = query.state.data?.connected ?? false
      const waking = resumePending || (active && !connected)
      // Keep the fast poll going a beat past connect until the backend
      // finalizes the wake number (background logs fetch) — the toast holds
      // for `final`, and this is how it arrives promptly.
      const wake = query.state.data?.last_wake
      const refining =
        wake != null && !wake.final && Date.now() - wake.at * 1000 < 15_000
      return waking || refining ? 1000 : active ? 5000 : 15000
    },
  })
  // A shared turn can start or finish between status polls. Refresh the
  // lifecycle controls on that transition, just as local SSE completion does.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['status', viewId] })
  }, [queryClient, viewId, active])
  const snapshot = statusQuery.data

  // Auto-start path of the wake toast: a message sent to a paused chat wakes
  // the sandbox server-side mid-turn — the 5s active poll picks the wake up.
  useEffect(() => {
    announceSandboxWake(snapshot)
  }, [snapshot])

  // Same cache key as the workspace pane's tree, so the "@" mention picker
  // rides the sidecar's polling for free instead of fetching on its own.
  const filesQuery = useQuery({
    queryKey: ['files', viewId],
    queryFn: () => fetchFiles(clientId, viewId),
    enabled: snapshot?.connected ?? false,
  })
  // Single pass over the tree (files only, path picked out). No useMemo —
  // the compiler caches this keyed on filesQuery.data (which React Query
  // keeps referentially stable via structural sharing), so the Composer's
  // mention Set isn't rebuilt on unrelated renders.
  const mentionFiles = (() => {
    if (!filesQuery.data) return undefined
    const paths: string[] = []
    for (const entry of filesQuery.data.files) {
      if (entry.kind === 'file') {
        paths.push(entry.path)
      }
    }
    return paths
  })()

  // Same cache entry KeySetupCard reads/writes — saving keys anywhere flips
  // the empty state from the gate back to the prompt suggestions.
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth })

  const keysMissing =
    healthQuery.data !== undefined &&
    !(healthQuery.data.has_e2b_key && healthQuery.data.has_openai_key)
  const hasKeys = Boolean(
    healthQuery.data?.has_e2b_key ||
    healthQuery.data?.has_openai_key ||
    healthQuery.data?.has_executor_key
  )
  const hostKeyMissing =
    !(healthQuery.data?.has_openai_key ?? snapshot?.env_key_available ?? true)

  return { snapshot, mentionFiles, keysMissing, hasKeys, hostKeyMissing }
}
