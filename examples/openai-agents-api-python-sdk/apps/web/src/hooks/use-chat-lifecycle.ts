import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createElement, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  getClientId,
  postFork,
  postPause,
  postReset,
  postResume,
  type SessionSnapshot,
} from '@/api/client'
import { dropChat, seedChat } from '@/lib/chat-store'
import {
  receiveSession,
  removeSession,
  getSession,
  markSessionExpired,
  setSessionMeta,
} from '@/lib/sessions'
import { announceSandboxWake } from '@/lib/wake-toast'
import { Loader } from '@/components/ui/loader'

const clientId = getClientId()

// The chat lifecycle mutations: resume/warm, fork/promote, pause. viewId/
// setViewId thread the current view through; a ref guards resume results that
// settle after the user already moved on.
export function useChatLifecycle(viewId: string, setViewId: (id: string) => void) {
  const queryClient = useQueryClient()

  // Latest viewed chat — a resume that settles after the user already moved
  // on (clicked New chat, picked another row) must not apply stale results.
  // Written in an effect (not during render) so a replayed/discarded render
  // never leaks into it.
  const viewIdRef = useRef(viewId)
  useEffect(() => {
    viewIdRef.current = viewId
  }, [viewId])

  // Warm-up on select: reattach the chat's session + sandbox. The backend
  // pauses other IDLE chats in the background — streaming chats are left
  // alone, which is what makes parallel sessions possible. Sending without
  // the warm-up also works; it just front-loads the reconnect wait.
  const resumeMutation = useMutation({
    mutationFn: (id: string) => postResume(clientId, id),
    onSuccess: (result, id) => {
      if (result.expired) {
        markSessionExpired(
          id,
          result.session.terminal_reason === 'expired' &&
            result.session.sandbox !== null
        )
        queryClient.setQueryData(['status', id], result.session)
        return
      }
      // Backfill the sidebar label: chats archived before a turn reported a
      // sandbox id get one here, on first resume. Skipped when null so a
      // recreate-in-progress never clobbers a known id.
      if (result.session.sandbox) {
        setSessionMeta(id, {
          sandboxId: result.session.sandbox,
          sessionId: result.session.session_id,
          // Repairs the fork tree for chats deep-linked in a browser that
          // never saw the fork happen (undefined = leave untouched). Cast:
          // the widened SessionSnapshot carries parent_chat_id until the
          // generated spec does.
          parentChatId: (result.session as SessionSnapshot).parent_chat_id,
        })
      }
      // Manual/warm resume path of the wake toast — before the stale-view
      // guard, the sandbox woke whether or not the user is still looking.
      announceSandboxWake(result.session as SessionSnapshot)
      if (viewIdRef.current !== id) {
        return // stale — the user switched away while this resume ran
      }
      // The resume response already carries the fresh snapshot — write it
      // straight into the cache so the pill flips to connected immediately
      // instead of waiting for an invalidate → refetch round trip.
      queryClient.setQueryData(['status', id], result.session)
      void queryClient.invalidateQueries({ queryKey: ['files', id] })
    },
  })

  const warmChat = (id: string) => {
    const record = getSession(id)
    if (record && !record.expired) {
      resumeMutation.mutate(id)
    }
  }

  // Fork from a row's fork button / ⋮ menu: the backend clones the chat and
  // mints the new chat_id and copies its transcript on the coordinator.
  // Hydrate the returned archive before the route effect runs,
  // then select it. promote clones as a root chat (parent_chat_id=null) —
  // never coalesce that null back to the parent, only an absent field.
  // sibling clones at the source's own nesting level (decayed-chat recovery:
  // the fork succeeds the dead chat, it doesn't descend from it).
  // No warmChat: a 200 fork response means the new chat is already attached.
  // One toast rides the whole lifecycle (loading → success/error via a shared
  // id); the error state carries a Try again CTA that re-fires the mutation.
  const forkMutation = useMutation({
    mutationFn: ({
      id,
      promote,
      sibling,
    }: {
      id: string
      promote?: boolean
      sibling?: boolean
    }) => postFork(clientId, id, { promote, sibling }),
    onMutate: ({ promote, sibling }) => ({
      toastId: toast.loading(
        promote
          ? 'Promoting fork — spinning up a new sandbox…'
          : sibling
            ? 'Recovering chat — spinning up a new sandbox…'
            : 'Creating fork — spinning up a new sandbox…',
        { icon: createElement(Loader, { className: 'text-xs' }) }
      ),
    }),
    onSuccess: ({ chat, archive }, { id: parentId, promote, sibling }, context) => {
      toast.success(
        promote
          ? 'Promoted — new sandbox is ready'
          : sibling
            ? 'Recovered — new sandbox is ready'
            : 'Fork ready — sandbox booted',
        { id: context.toastId }
      )
      const newId = chat.chat_id
      if (!newId) {
        return
      }
      // Fork/promote mints a brand-new chat with a freshly created sandbox —
      // announce its wake too (the success toast above covers the fork
      // itself; this one flexes the spin-up number).
      announceSandboxWake(chat as SessionSnapshot)
      receiveSession(archive)
      seedChat(newId, archive.turns)
      if (sibling) {
        removeSession(parentId)
        dropChat(parentId)
        void queryClient.removeQueries({ queryKey: ['status', parentId] })
        void queryClient.removeQueries({ queryKey: ['files', parentId] })
        void queryClient.removeQueries({ queryKey: ['file', parentId] })
        void queryClient.removeQueries({ queryKey: ['workspace-pane', parentId] })
        postReset(clientId, parentId).catch((error) => {
          toast.error(
            error instanceof Error
              ? `Recovered, but old sandbox cleanup failed: ${error.message}`
              : 'Recovered, but old sandbox cleanup failed.'
          )
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['chat-archive'] })
      // Seed the complete fork snapshot before navigation. The workspace pane
      // gates file queries on snapshot.connected, so invalidation alone leaves
      // the recovered sandbox detached until another status request finishes.
      queryClient.setQueryData(['status', newId], chat)
      void queryClient.invalidateQueries({ queryKey: ['files', newId] })
      setViewId(newId)
    },
    onError: (error, variables, context) => {
      toast.error(
        error instanceof Error ? error.message : 'Fork failed',
        {
          id: context?.toastId,
          duration: 10_000,
          action: {
            label: 'Try again',
            onClick: () => forkMutation.mutate(variables),
          },
        }
      )
    },
  })
  // Row whose fork/promote is in flight — its fork button swaps to a loader.
  const forkingId = forkMutation.isPending ? forkMutation.variables.id : null

  // Manual pause from the lifecycle pill — the sandbox snapshots now, the
  // next message (or the pill's resume) reattaches it.
  const pauseMutation = useMutation({
    mutationFn: (id: string) => postPause(clientId, id),
    onSuccess: (result, id) => {
      queryClient.setQueryData(['status', id], result.session)
    },
  })

  return { resumeMutation, warmChat, forkMutation, forkingId, pauseMutation }
}
