import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getClientId, postReset } from '@/api/client'
import { ApiKeySettingsProvider } from '@/components/api-key-settings'
import { AppSidebar } from '@/components/app-sidebar'
import { hasDelegation } from '@/components/chat/chat-footnote'
import { ComposerSection } from '@/components/chat/composer-section'
import { Greeting } from '@/components/chat/greeting'
import {
  Transcript,
  type TranscriptHandle,
} from '@/components/chat/transcript'
import { SidePanel } from '@/components/side-panel'
import { Toaster } from '@/components/ui/sonner'
import { WorkbenchHeader } from '@/components/workbench-header'
import { WorkspacePane } from '@/components/workspace-pane'
import { useChatLifecycle } from '@/hooks/use-chat-lifecycle'
import { useWorkbenchQueries } from '@/hooks/use-workbench-queries'
import {
  cancelChatTurn,
  dropChat,
  isTurnTerminal,
  removeQueuedPrompt,
  syncSharedChats,
  sendChatPrompt,
  steerChatPrompt,
  setViewedChat,
  useActiveChatIds,
  useAutoPausingChatIds,
  useChatState,
  useUnseenChatIds,
} from '@/lib/chat-store'
import { setMobilePanelOpen } from '@/lib/panels'
import {
  currentSessionId,
  getSession,
  newSessionId,
  removeSession,
  setCurrentChat,
  useSessionArchive,
} from '@/lib/sessions'

export const Route = createFileRoute('/')({
  // The viewed chat lives in the URL (?chat=…) — reload/deep-link lands on
  // the same conversation, and the workspace sidecar follows it.
  validateSearch: (search: Record<string, unknown>) => ({
    chat:
      typeof search.chat === 'string' && search.chat.length > 0
        ? search.chat
        : undefined,
  }),
  component: WorkbenchPage,
})

const clientId = getClientId()

function WorkbenchPage() {
  const { sessions, ready: archiveReady, error: archiveError, retry: retryArchive } = useSessionArchive()

  // The viewed chat is URL-driven (?chat=…). Every non-expired chat accepts
  // messages — turns stream from the module-scope chat store, so a running
  // turn keeps going while the user works in another chat in parallel.
  const { chat: urlChat } = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  // No ?chat= in the URL = draft view: the reload default at first, then a
  // fresh id per "New chat" click. The id stays out of the URL until the
  // first send pins it (see sendPrompt).
  const [draftId, setDraftId] = useState(currentSessionId)
  const viewId = urlChat ?? draftId
  const setViewId = (id: string) => void navigate({ search: { chat: id } })

  const { turns, active, queued, steering } = useChatState(viewId)
  const activeIds = useActiveChatIds()
  const unseenIds = useUnseenChatIds()
  // End-of-turn auto-pause snapshots in flight — drives the same "pausing…"
  // chip as a manual pause so the pill reacts the moment the turn ends.
  const autoPausingIds = useAutoPausingChatIds()

  // Mark the viewed chat before syncing completions, so it stays read.
  // All chats receive shared state, including unselected sidebar rows.
  useEffect(() => {
    setCurrentChat(viewId)
    setViewedChat(viewId)
    syncSharedChats(sessions)
  }, [viewId, sessions])

  const { resumeMutation, warmChat, forkMutation, forkingId, pauseMutation } =
    useChatLifecycle(viewId, setViewId)

  const { snapshot, mentionFiles, keysMissing, hasKeys, hostKeyMissing } = useWorkbenchQueries(
    viewId,
    active,
    resumeMutation.isPending && resumeMutation.variables === viewId
  )

  const selectChat = (id: string) => {
    if (id !== viewId) {
      warmChat(id)
    }
    setViewId(id)
    // Landing in a chat dismisses the mobile drawer (no-op on desktop, where
    // the drawer state is never set).
    setMobilePanelOpen('left', false)
  }

  // Deep link / reload: warm the landing chat once.
  const warmedRef = useRef(false)
  const transcriptRef = useRef<TranscriptHandle>(null)
  // Scroll-to-bottom affordance: only shown once the reader scrolls up.
  const [showScrollDown, setShowScrollDown] = useState(false)
  useEffect(() => {
    if (warmedRef.current || !getSession(viewId)) {
      return
    }
    warmedRef.current = true
    warmChat(viewId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, viewId])

  // "New chat" is just the bare route — a fresh id backs the view in memory,
  // but nothing hits the URL until an action needs the identity.
  const startNewChat = () => {
    setDraftId(newSessionId())
    void navigate({ search: { chat: undefined } })
    setMobilePanelOpen('left', false)
  }

  // First action pins a draft chat into the URL (?chat=…) so reload and
  // deep-link land on the conversation it just started.
  const sendPrompt = (text: string) => {
    if (!archiveReady) return
    if (!urlChat) {
      setViewId(viewId)
    }
    sendChatPrompt(viewId, text)
    // Sending always brings the sender to their own message and re-engages
    // stream follow, even if they were scrolled up reading history.
    transcriptRef.current?.scrollToBottom()
  }

  const deleteChat = async (id: string) => {
    try {
      await postReset(clientId, id)
      dropChat(id)
      removeSession(id)
      if (id === viewId) startNewChat()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete chat.')
    }
  }

  const viewedSession = sessions.find((session) => session.id === viewId)
  const viewExpired = viewedSession?.expired === true
  // A newer pause always beats an older in-flight resume — otherwise pausing
  // mid-resume leaves the pill stuck on "resuming…" until the stale resume
  // settles (up to its 120s cap) instead of flipping to paused/resume.
  const pausedOverResume =
    pauseMutation.variables === viewId &&
    !pauseMutation.isError &&
    pauseMutation.submittedAt > (resumeMutation.submittedAt ?? 0)
  // The status poll clearing `connected` is the ground truth — if it reports
  // the chat live while the resume response straggles, drop the chip early.
  const resumingView =
    (resumeMutation.isPending &&
      resumeMutation.variables === viewId &&
      !pausedOverResume &&
      !(snapshot?.connected ?? false)) ||
    // Sending into a paused chat auto-resumes server-side — show "resuming…"
    // right away instead of a stale "paused" until the status poll catches up
    // (the turn's terminal snapshot flips the cache to connected).
    (active && (snapshot?.paused ?? false) && !(snapshot?.connected ?? false))
  const resumeFailed =
    resumeMutation.isError && resumeMutation.variables === viewId
  const latestTurn = turns.at(-1)
  const terminal =
    snapshot?.terminal_reason != null || isTurnTerminal(latestTurn)
  const terminalForkable =
    snapshot?.terminal_reason != null
      ? snapshot.sandbox !== null
      : latestTurn?.forkable === true || latestTurn?.errorCode === 'decayed'
  const recovering = forkMutation.isPending && forkingId === viewId
  const recoverChat = () =>
    forkMutation.mutate({ id: viewId, sibling: true })

  return (
    <div className="flex h-svh flex-col bg-bg-1">
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* Chats live in the collapsible/resizable left panel… */}
      <SidePanel side="left">
        <AppSidebar
          activeIds={activeIds}
          forkingId={forkingId}
          onDelete={deleteChat}
          onFork={(id) => forkMutation.mutate({ id })}
          onPromote={(id) => forkMutation.mutate({ id, promote: true })}
          onNew={startNewChat}
          onSelect={selectChat}
          sessions={sessions}
          unseenIds={unseenIds}
          viewId={viewId}
        />
      </SidePanel>
      <ApiKeySettingsProvider keysMissing={keysMissing} hasKeys={hasKeys}>
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg shadow-[var(--shadow-card)]">
        {/* App-wide toaster, scoped INTO the chat pane: !absolute overrides
            sonner's fixed positioning so top-center means the chat window's
            center, not the viewport's (which the sidebars would skew). */}
        <Toaster className="!absolute" />
        <WorkbenchHeader
          hostKeyMissing={hostKeyMissing}
          onPause={() => pauseMutation.mutate(viewId)}
          // Straight to the mutation — warmChat's archive guard would no-op
          // in a tab that deep-linked into a chat it never archived locally,
          // and the pill only offers resume when the backend says paused.
          onResume={() => resumeMutation.mutate(viewId)}
          pausing={
            (pauseMutation.isPending && pauseMutation.variables === viewId) ||
            autoPausingIds.split(',').includes(viewId)
          }
          resuming={resumingView}
          snapshot={snapshot}
          viewExpired={viewExpired}
        />
        {!archiveReady && (
          <div className="px-4 py-2 text-sm text-fg-secondary" role="status">
            {archiveError ? (
              <>Could not load chat history. <button className="underline" onClick={() => void retryArchive()}>Try again</button></>
            ) : 'Loading chat history…'}
          </div>
        )}
        <Transcript
          empty={<Greeting />}
          onAtBottomChange={(atBottom) => setShowScrollDown(!atBottom)}
          // Recovery forks as a sibling: the new chat takes the failed one's
          // place in the tree instead of nesting under it.
          forking={recovering}
          onFork={recoverChat}
          ref={transcriptRef}
          sessionKey={viewId}
          turns={turns}
          rootAgentOnly={hasDelegation(snapshot)}
          snapshot={snapshot}
          sessionId={getSession(viewId)?.sessionId}
        />
        <ComposerSection
          chatId={viewId}
          disabled={!archiveReady}
          active={active}
          failureMessage={
            resumeMutation.error instanceof Error
              ? resumeMutation.error.message
              : undefined
          }
          forkable={
            terminalForkable || (viewExpired && viewedSession?.forkable === true)
          }
          forking={recovering}
          keysMissing={keysMissing}
          mentionFiles={mentionFiles}
          onCancel={() => cancelChatTurn(viewId)}
          onFork={recoverChat}
          onNew={startNewChat}
          onRetry={() => warmChat(viewId)}
          onScrollToBottom={() => transcriptRef.current?.scrollToBottom()}
          onSend={sendPrompt}
          onSteer={(text) => steerChatPrompt(viewId, text)}
          onUnqueue={(index) => removeQueuedPrompt(viewId, index)}
          queued={queued}
          steering={steering}
          turns={turns}
          resumeFailed={resumeFailed}
          showScrollDown={showScrollDown}
          snapshot={snapshot}
          capabilities={viewedSession?.capabilities}
          terminal={terminal}
          turnCount={turns.length}
          viewExpired={viewExpired}
        />
      </section>
      </ApiKeySettingsProvider>
      {/* …and the workspace (file tree + preview) in the right one. On
          mobile both panels render as offcanvas drawers over the chat. */}
      <SidePanel side="right">
        {/* mr-1 mirrors the left sidebar's pl-1 — same inset from both
            viewport edges. Desktop-only (68rem = the useIsMobile line):
            in the mobile drawer the SidePanel already draws the edge
            border, so the pane's own border would double it and the
            inset would leave a stray gutter. */}
        <WorkspacePane
          active={active}
          chatId={viewId}
          className="flex h-full border-0 min-[68rem]:mr-1 min-[68rem]:border"
          connected={snapshot?.connected ?? false}
          logsAvailable={snapshot?.session_id != null}
        />
      </SidePanel>
      </div>
    </div>
  )
}
