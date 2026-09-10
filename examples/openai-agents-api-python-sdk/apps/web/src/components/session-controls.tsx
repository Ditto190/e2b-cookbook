import { PausedIcon, StartedIcon } from '@/ui/primitives/icons'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader } from '@/components/ui/loader'
import type { SessionSnapshot } from '@/api/client'
import { setAutoPause, useAutoPause } from '@/lib/settings'
import { cn } from '@/lib/utils'

// The sandbox idle TTL (backend SANDBOX_TTL_SECONDS). Clock skew between this
// machine and the sandbox's reported end_at can push the naive remainder past
// the full TTL — the countdown clamps so it never claims more than "15m 0s".
const MAX_REMAINING_SECONDS = 15 * 60

// Ticks once a second toward the sandbox's SDK-reported deadline
// (SessionSnapshot.timeout_at). Null when unset, invalid, or already past.
function useCountdown(
  iso: string | null | undefined
): { minutes: number; seconds: number } | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!iso) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [iso])
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (Number.isNaN(ms) || ms <= 0) return null
  const total = Math.min(Math.floor(ms / 1000), MAX_REMAINING_SECONDS)
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

// Fixed-width right-aligned digit slot: when a value drops from two digits to
// one, the digit slides toward its unit ("m"/"s") and the units never move.
function Digits({ value }: { value: number }) {
  return (
    <span className="inline-block min-w-[2ch] text-right">{value}</span>
  )
}

// One segmented control, divider-split like two buttons in one pill:
// [pause/play icon] │ [status text] │ [auto-pause]. Only the icon segment
// acts on the lifecycle — the status text is inert — and the auto-pause
// toggle lives inside the same pill, so no state flip or hover ever shifts
// the header layout.
export function SessionControls({
  snapshot,
  resuming,
  pausing,
  onPause,
  onResume,
}: {
  snapshot: SessionSnapshot | undefined
  resuming: boolean
  pausing: boolean
  onPause: () => void
  onResume: () => void
}) {
  const autoPause = useAutoPause()
  const connected = snapshot?.connected ?? false
  const paused = snapshot?.paused ?? false
  const remaining = useCountdown(connected ? snapshot?.timeout_at : null)
  const busy = resuming || pausing
  // Switching chats leaves the status query momentarily empty — render a
  // quiet ellipsis instead of flashing a wrong "idle" before the fetch lands.
  const loading = !busy && snapshot === undefined

  // One name per visual state: keys the status span so a state change
  // remounts it and replays the fade — but ticking digits share a key, so
  // the countdown never re-fades second to second.
  const kind = busy
    ? resuming
      ? 'resuming'
      : 'pausing'
    : loading
      ? 'loading'
      : connected
        ? remaining
          ? 'countdown'
          : 'connected'
        : paused
          ? 'paused'
          : 'idle'

  // Countdown renders as JSX so each number sits in a fixed-width slot —
  // minutes always shown ("0m 53s") so no block ever pops in/out mid-tick.
  const status = busy
    ? resuming
      ? 'resuming…'
      : 'pausing…'
    : loading
      ? '…'
      : connected
        ? remaining
          ? (
              <span>
                timeout in <Digits value={remaining.minutes} />m{' '}
                <Digits value={remaining.seconds} />s
              </span>
            )
          : 'connected'
        : paused
          ? 'paused'
          : 'idle'
  const action = connected ? onPause : paused ? onResume : undefined

  return (
    // Segment order: status/timeout first, then the pause/resume action, then
    // the auto-pause toggle.
    // h-7 matches the header's icon-sm buttons (theme/activity toggles) so
    // the strip and their pressed-state fills read as one row.
    <span className="inline-flex h-7 items-stretch divide-x divide-stroke overflow-hidden whitespace-nowrap border border-stroke text-[11px]">
      <span
        className={cn(
          'grid px-2 py-0.5 tabular-nums transition-colors duration-300',
          connected
            ? 'bg-accent-positive-bg text-accent-positive-highlight'
            : 'bg-fill text-fg-tertiary'
        )}
      >
        {/* Invisible spacer pins the segment to its widest state (countdown
            with the pulse dot), so status flips never shift the header. */}
        <span
          aria-hidden
          className="invisible col-start-1 row-start-1 flex items-center gap-1.5"
        >
          <span className="size-1.5" />
          timeout in 00m 00s
        </span>
        {/* Keyed by state kind: each flip (idle → countdown, chat switch…)
            remounts and fades in instead of popping. */}
        <span
          className="fade-in col-start-1 row-start-1 flex items-center justify-center gap-1.5"
          key={kind}
        >
          {connected && !busy && (
            <span className="size-1.5 animate-pulse bg-current" />
          )}
          {status}
        </span>
      </span>
      <button
        aria-label={connected ? 'Pause the sandbox' : 'Resume the sandbox'}
        className={cn(
          'flex items-center px-2 transition-colors',
          action && !busy
            ? 'text-fg-tertiary hover:bg-bg-highlight hover:text-fg'
            : 'cursor-default text-fg-tertiary/40'
        )}
        disabled={!action || busy}
        onClick={action}
        title={
          connected
            ? 'Pause the sandbox now — the next message resumes it'
            : paused
              ? 'Resume the sandbox and reattach the session'
              : undefined
        }
        type="button"
      >
        {busy ? (
          // Fixed size-3 box: the spinner glyph is narrower than the
          // pause/play icons, and the button must not change width.
          <span className="flex size-3 items-center justify-center">
            <Loader size="sm" className="text-xs" />
          </span>
        ) : connected ? (
          <PausedIcon className="size-3" />
        ) : (
          <StartedIcon className="size-3" />
        )}
      </button>
      <button
        className={cn(
          'flex items-center px-2 transition-colors',
          // On-state matches the header's activity-log toggle (the tool call
          // messages switch): light fill-highlight + full-strength text.
          autoPause
            ? 'bg-fill-highlight/40 text-fg'
            : 'text-fg-tertiary/50 hover:text-fg'
        )}
        onClick={() => {
          const next = !autoPause
          setAutoPause(next)
          // Shared id: rapid toggling replaces the toast instead of stacking.
          toast.info(
            next
              ? 'Takes effect at the end of the next turn'
              : 'The sandbox idles out its TTL instead',
            { id: 'auto-pause' }
          )
        }}
        title="Auto-pause: snapshot the sandbox right after each turn — the next message resumes it"
        type="button"
      >
        auto-pause
      </button>
    </span>
  )
}
