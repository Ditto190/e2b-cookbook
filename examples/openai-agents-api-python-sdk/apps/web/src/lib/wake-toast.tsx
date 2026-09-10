import { toast } from 'sonner'
import type { SessionSnapshot } from '@/api/client'
import { sandboxConsoleUrl } from '@/lib/e2b-links'

// Wakes already announced (chat_id:seq). The FE holds the toast until the
// backend marks the wake final (background logs fetch settled), so each wake
// fires exactly once, already carrying the definitive number.
const announced = new Set<string>()

// A wake older than this is history — a page reload replaying the previous
// snapshot, not something the user just triggered. Mark seen, stay quiet.
const FRESH_MS = 30_000

// Mono sandbox-id chip: click copies the id (so the fast starter can be
// looked up anywhere — CLI, dashboard, logs) with a small confirming toast.
function SandboxIdChip({ sandboxId }: { sandboxId: string }) {
  return (
    <button
      className="cursor-pointer font-mono text-xs text-fg transition-colors hover:text-accent-main-highlight"
      onClick={() => {
        navigator.clipboard.writeText(sandboxId).then(() => {
          toast.success('sandbox id copied', { id: 'sandbox-id-copied' })
        })
      }}
      title="Copy sandbox id"
      type="button"
    >
      {sandboxId}
    </button>
  )
}

/** Flex the E2B spin-up: one orange toast per sandbox wake ("sandbox started
 * in 233 ms"). Call with any snapshot as it arrives — status polls, resume
 * responses, terminal turn events — dedupe makes over-calling harmless. */
export function announceSandboxWake(
  session: SessionSnapshot | undefined | null
) {
  const wake = session?.last_wake
  if (!wake || !wake.final || !session?.chat_id) return
  const key = `${session.chat_id}:${wake.seq}`
  if (announced.has(key)) return
  announced.add(key)
  if (Date.now() - wake.at * 1000 > FRESH_MS) return
  const sandboxId = session.sandbox
  const clockLine = wake.infra
    ? "E2B's own clock, read from the sandbox logs"
    : 'SDK round trip'
  toast(
    // Copyable id rides in the title block, one step smaller than the
    // timing text so both fit the first row — keeps the toast two lines.
    <span className="flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
      {sandboxId ? <SandboxIdChip sandboxId={sandboxId} /> : null}
      <span>
        {`sandbox ${wake.kind === 'resumed' ? 'resumed' : 'started'} in ${wake.ms} ms`}
      </span>
    </span>,
    {
      id: `sandbox-wake-${session.chat_id}`,
      // Clock line — doubles as a deep link into this sandbox's dashboard
      // page (its Logs tab holds the very lines the timing was diffed from)
      // once the infra number lands.
      description: (
        <span className="flex flex-col items-center gap-0.5">
          {wake.infra && sandboxId ? (
            <a
              // Neutral fg underline (reads as a link without shouting);
              // full accent on hover.
              className="underline decoration-fg/50 underline-offset-2 transition-colors hover:text-accent-main-highlight hover:decoration-accent-main-highlight"
              href={sandboxConsoleUrl(sandboxId)}
              rel="noreferrer"
              target="_blank"
            >
              {clockLine}
            </a>
          ) : (
            clockLine
          )}
        </span>
      ),
      // E2B-orange tone on the panel surface — accent-main text + border
      // over the solid toast bg (the translucent accent bg would let the
      // page bleed through).
      className:
        '!border-accent-main-highlight/40 !bg-bg-1 !text-accent-main-highlight !justify-center !text-center',
      // fg-secondary, not a washed-out accent tint — the description has to
      // stay readable as body text (and as a link) on both themes.
      descriptionClassName: '!text-fg-secondary',
    }
  )
}
