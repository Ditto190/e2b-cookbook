import type { SessionSnapshot } from '@/api/client'
import type { Turn } from '@/lib/chat-store'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { EditIcon, RefreshIcon } from '@/ui/primitives/icons'

// Replaces the composer only when the chat truly can't take a message:
// expired (dead upstream — permanent) or a failed resume (retryable — the
// chat was NOT poisoned). A resume in flight keeps the composer; sends queue
// behind the backend's per-chat single-flight launch.
export function ChatFootnote({
  expired,
  terminal,
  forkable,
  failureMessage,
  onFork,
  forking,
  onRetry,
  onNew,
}: {
  expired: boolean
  terminal: boolean
  forkable: boolean
  failureMessage?: string
  onFork: () => void
  forking: boolean
  onRetry: () => void
  onNew: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-stroke bg-bg-1 px-4 py-3">
      {expired || terminal ? (
        <p className="text-label text-fg-tertiary">
          {forkable
            ? 'This thread cannot continue. Recover its workspace in a fresh chat.'
            : "This chat's session expired upstream — read-only archive."}
        </p>
      ) : (
        <p className="min-w-0 truncate text-label text-accent-error-highlight">
          Resume failed{failureMessage ? ` — ${failureMessage}` : ''}. The chat
          is intact; try again.
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {(expired || terminal) && forkable ? (
          <Button
            disabled={forking}
            onClick={onFork}
            type="button"
            variant="secondary"
          >
            {forking ? <Loader /> : null}
            {forking ? 'Recovering…' : 'Fork to continue'}
          </Button>
        ) : !expired && !terminal ? (
          <Button onClick={onRetry} type="button" variant="secondary">
            <RefreshIcon />
            Retry
          </Button>
        ) : null}
        <Button onClick={onNew} type="button" variant="secondary">
          <EditIcon />
          New chat
        </Button>
      </div>
    </div>
  )
}


// Ticket 01 owns this contract; older snapshots have no capabilities object.
export function hasDelegation(snapshot: SessionSnapshot | undefined): boolean {
  return (snapshot as (SessionSnapshot & {
    capabilities?: { delegation?: { enabled?: boolean } }
  }) | undefined)?.capabilities?.delegation?.enabled === true
}

function usageText(usage: NonNullable<Turn['usage']>): string {
  const fields: string[] = []
  const cached = usage.input_tokens_details?.cached_tokens
  const reasoning = usage.output_tokens_details?.reasoning_tokens
  if (usage.input_tokens !== undefined) {
    fields.push(`${usage.input_tokens} input${cached !== undefined ? ` (${cached} cached)` : ''}`)
  } else if (cached !== undefined) {
    fields.push(`${cached} cached (input subset)`)
  }
  if (usage.output_tokens !== undefined) {
    fields.push(`${usage.output_tokens} output${reasoning !== undefined ? ` (${reasoning} reasoning)` : ''}`)
  } else if (reasoning !== undefined) {
    fields.push(`${reasoning} reasoning (output subset)`)
  }
  if (usage.total_tokens !== undefined) fields.push(`${usage.total_tokens} total`)
  return fields.join(', ')
}

export function TurnUsage({ turn, rootAgentOnly = false }: { turn: Turn; rootAgentOnly?: boolean }) {
  const text = turn.usage && usageText(turn.usage)
  if (!text) return null
  return <p className="px-1 text-label text-fg-tertiary">Turn tokens: {text}{rootAgentOnly ? ' · root agent only' : ''}</p>
}

export function UsageFootnote({ turns, snapshot, sessionId }: {
  turns: Turn[]
  snapshot?: SessionSnapshot
  sessionId?: string | null
}) {
  const terminalTurns = [...new Map(turns
    .filter((turn) => turn.outcome !== 'running' && (turn.prompt || turn.upstreamTurnId))
    .map((turn) => [turn.upstreamTurnId ?? turn.id, turn])).values()]
  const usages = terminalTurns.flatMap((turn) => turn.usage && usageText(turn.usage) ? [turn.usage] : [])
  const sum = (values: (number | undefined)[]) => {
    const supplied = values.filter((value) => value !== undefined)
    return supplied.length ? supplied.reduce((total, value) => total + value, 0) : undefined
  }
  const input = sum(usages.map((usage) => usage.input_tokens))
  const output = sum(usages.map((usage) => usage.output_tokens))
  const total = usageText({
    input_tokens: input,
    output_tokens: output,
    input_tokens_details: { cached_tokens: sum(usages.map((usage) => usage.input_tokens_details?.cached_tokens)) },
    output_tokens_details: { reasoning_tokens: sum(usages.map((usage) => usage.output_tokens_details?.reasoning_tokens)) },
    total_tokens: input !== undefined && output !== undefined ? input + output : undefined,
  })
  const partial = usages.length < terminalTurns.length || usages.some((usage) =>
    usage.input_tokens === undefined || usage.output_tokens === undefined)
  const id = snapshot?.session_id ?? sessionId
  const rootAgentOnly = hasDelegation(snapshot)
  if (!terminalTurns.length && !id) return null
  return (
    <div className="flex flex-col items-start gap-1 px-1 text-label text-fg-tertiary">
      {terminalTurns.length > 0 && <p>Chat tokens: {total || 'unavailable'} · {partial ? 'partial ' : ''}({usages.length} of {terminalTurns.length} turns)</p>}
      {rootAgentOnly && <span>root agent only</span>}
      {id && <button aria-label={`Copy session id ${id}`} className="break-all text-left hover:text-fg" onClick={() => void navigator.clipboard.writeText(id)} title="Copy session id" type="button">Session: {id}</button>}
      {snapshot?.trace_url && <a className="underline" href={snapshot.trace_url} rel="noreferrer" target="_blank">Open trace</a>}
    </div>
  )
}
