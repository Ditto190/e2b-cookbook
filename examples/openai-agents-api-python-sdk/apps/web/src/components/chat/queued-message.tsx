import { Loader } from '@/components/ui/loader'
import { getClientId } from '@/api/client'
import type { ChatState, Turn } from '@/lib/chat-store'
import { cn } from '@/lib/utils'
import { CloseIcon, HistoryIcon } from '@/ui/primitives/icons'

// A prompt accepted while a turn was still streaming. Deliberately NOT a
// transcript bubble — nothing has been sent yet. It sits directly above the
// composer and disappears when the running turn ends and the store flushes
// the queue FIFO (chat-store sendChatPrompt).
function QueuedMessage({
  text,
  note,
  label,
  busy,
  onRemove,
  onSteer,
}: {
  text: string
  /** Extra subtitle tail (e.g. "· 2 more behind" on the stack's front card). */
  note?: string
  label: string
  busy?: boolean
  onRemove?: () => void
  onSteer?: () => void
}) {
  return (
    <div className="fade-up flex items-start gap-2.5 border border-stroke border-dashed bg-bg-1 px-3.5 py-2.5">
      {busy ? <Loader role="status" aria-label="Steering in progress" className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" /> : <HistoryIcon className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" />}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-[1.55]">
          {text}
        </p>
        <p className="mt-1 text-[11px] text-fg-tertiary">
          {label}
          {note ? ` ${note}` : ''}
        </p>
      </div>
      {(onRemove || onSteer) && <div className="flex shrink-0 flex-col items-end justify-between gap-2 self-stretch">
        {onRemove && <button
          aria-label="Remove queued message"
          className="text-fg-tertiary transition-colors hover:text-fg"
          onClick={onRemove}
          type="button"
        >
          <CloseIcon className="size-3.5" />
        </button>}
        {onSteer && <button
          aria-label="Steer queued message"
          className="flex items-center gap-3 text-xs leading-none text-fg-secondary transition-colors hover:text-fg"
          onClick={onSteer}
          type="button"
        >
          <span>Steer</span>
          <kbd className="inline-flex h-6 items-center justify-center gap-1.5 border border-stroke px-2 font-mono text-xs leading-none">
            <span className="text-base leading-none">⌘</span>Enter
          </kbd>
        </button>}
      </div>}
    </div>
  )
}

// Sonner-style stack: the queue head is the front card (next to send); later
// prompts collapse to card edges peeking above it and unfold on hover. The
// DOM renders tail→head so the head paints last (on top) without z-index
// bookkeeping; a card's queue index doubles as its visual depth.
export function QueuedStack({
  queued,
  onUnqueue,
  onSteer,
  label = 'Queued \u2014 sends when the current turn finishes',
  notes,
  busy,
}: {
  queued: string[]
  onUnqueue?: (index: number) => void
  onSteer?: (index: number) => void
  label?: string
  notes?: string[]
  busy?: boolean
}) {
  if (queued.length === 0) {
    return null
  }
  return (
    <div className="group/queue flex flex-col">
      {queued
        .map((text, index) => ({ text, index }))
        .reverse()
        .map(({ text, index }) => (
          <div
            className={cn(
              'transition-all duration-200',
              index > 0 &&
                'overflow-hidden group-hover/queue:mx-0 group-hover/queue:mb-2 group-hover/queue:max-h-40 group-hover/queue:opacity-100',
              index === 1 && 'mx-2 mb-1 max-h-2 opacity-80',
              index === 2 && 'mx-4 mb-1 max-h-1.5 opacity-60',
              index > 2 && 'mx-4 mb-0 max-h-0 opacity-0'
            )}
            key={`${index}-${text}`}
          >
            <QueuedMessage
              label={label}
              busy={busy}
              note={[
                notes?.[index],
                index === 0 && queued.length > 1 ? `· ${queued.length - 1} more behind` : undefined,
              ].filter(Boolean).join(' ')}
              onRemove={onUnqueue ? () => onUnqueue(index) : undefined}
              onSteer={onSteer ? () => onSteer(index) : undefined}
              text={text}
            />
          </div>
        ))}
    </div>
  )
}

/** Pending text is already redacted by the coordinator before display. */
export function SteeringStack({ turns, waiting = [] }: { turns: Turn[]; waiting?: ChatState['steering'] }) {
  const records = turns.flatMap((turn) => turn.interjections ?? [])
  const pending = [
    ...records.filter((row) => row.text_offset == null && (row.status === 'sending' || row.status === 'posted')),
    ...waiting.filter((row) => !records.some((record) => record.submission_id === row.submission_id))
      .map((row) => ({ ...row, by: getClientId() })),
  ]
  return <QueuedStack
    queued={pending.map((row) => row.text)}
    label="Steering"
    busy
    notes={pending.map((row) => row.by === getClientId() ? '' : '· Other viewer')}
  />
}
