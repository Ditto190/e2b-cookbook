import type { SessionSnapshot } from '@/api/client'
import { AgentControls } from '@/components/chat/agent-controls'
import { ChatFootnote } from '@/components/chat/chat-footnote'
import { Composer } from '@/components/chat/composer'
import { ApiKeyPanel } from '@/components/api-key-settings'
import type { ChatState, Turn } from '@/lib/chat-store'
import { QueuedStack, SteeringStack } from '@/components/chat/queued-message'
import { SuggestedActions } from '@/components/chat/suggested-actions'
import { Button } from '@/components/ui/button'
import { ArrowDownIcon } from '@/ui/primitives/icons'

// Everything below the transcript: empty-state suggestions (or the key gate),
// the floating scroll-to-bottom button, and the composer. An expired chat or
// a failed resume swaps the whole block for the footnote.
export function ComposerSection({
  viewExpired,
  forkable,
  terminal,
  resumeFailed,
  failureMessage,
  onFork,
  forking,
  onNew,
  onRetry,
  turnCount,
  keysMissing,
  active,
  disabled = false,
  queued,
  turns,
  steering,
  onUnqueue,
  onSend,
  onSteer,
  onCancel,
  showScrollDown,
  onScrollToBottom,
  mentionFiles,
  snapshot,
  capabilities,
  chatId,
}: {
  chatId?: string
  viewExpired: boolean
  /** Expired archive still has a retained backend sandbox to recover. */
  forkable: boolean
  /** Latest turn made this thread permanently unusable. */
  terminal: boolean
  /** The viewed chat's resume failed — retryable, the chat is intact. */
  resumeFailed: boolean
  failureMessage?: string
  onFork: () => void
  forking: boolean
  onNew: () => void
  onRetry: () => void
  turnCount: number
  keysMissing: boolean
  /** A turn is streaming in the viewed chat. */
  active: boolean
  disabled?: boolean
  /** Prompts parked while the turn streams — rendered as dashed chips. */
  queued: string[]
  turns: Turn[]
  steering?: ChatState['steering']
  onUnqueue: (index: number) => void
  onSend: (text: string) => void
  onSteer: (text: string) => void | Promise<void>
  onCancel: () => void
  showScrollDown: boolean
  onScrollToBottom: () => void
  mentionFiles: string[] | undefined
  snapshot: SessionSnapshot | undefined
  capabilities?: SessionSnapshot['capabilities']
}) {
  const steerQueued = (index: number) => {
    const text = queued[index]
    if (!active || disabled || text === undefined) return
    onUnqueue(index)
    void onSteer(text)
  }
  return (
    // p-2-equivalent insets match the workspace pane's drop-zone (p-2)
    // so the composer card and the dashed drop target share edges.
    <div className="relative mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-2 pb-2">
      <ApiKeyPanel keysMissing={keysMissing} />
      {viewExpired || terminal || resumeFailed ? (
        <ChatFootnote
          expired={viewExpired}
          forkable={forkable}
          failureMessage={failureMessage}
          forking={forking}
          onFork={onFork}
          onNew={onNew}
          onRetry={onRetry}
          terminal={terminal}
        />
      ) : (
        <>
          {turnCount === 0 && !keysMissing && (
            <SuggestedActions disabled={active || disabled} onPick={onSend} />
          )}
          {/* Backlog accepted mid-turn — above the composer, not in the
              transcript: nothing has been sent yet. Each card vanishes as
              the store flushes it into a real turn; 2+ collapse into a
              hover-to-unfold stack. */}
          <QueuedStack onUnqueue={onUnqueue} onSteer={active && !disabled ? steerQueued : undefined} queued={queued} />
          <SteeringStack turns={turns} waiting={steering} />
          <div className="relative">
            {/* Floats above the composer card, over the transcript's
                tail — only while the reader is scrolled up; at the
                bottom the button has nothing to do. */}
            {showScrollDown && (
              <div className="-top-11 -translate-x-1/2 absolute left-1/2 z-10">
                <Button
                  aria-label="Scroll to bottom"
                  className="bg-bg/85 shadow-[var(--shadow-float-soft)] backdrop-blur-sm"
                  onClick={onScrollToBottom}
                  size="icon-sm"
                  title="Scroll to bottom"
                  type="button"
                  variant="secondary"
                >
                  <ArrowDownIcon />
                </Button>
              </div>
            )}
            <Composer
              disabled={disabled}
              mentionFiles={mentionFiles}
              onCancel={onCancel}
              onSend={onSend}
              onSteer={onSteer}
              onSteerQueued={() => steerQueued(0)}
              placeholder="Ask the agent to inspect or change files in /workspace…"
              streaming={active}
              tools={
                <AgentControls
                  chatId={chatId}
                  active={active}
                  capabilities={capabilities}
                  snapshot={snapshot}
                  started={turnCount > 0}
                />
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
