import { parseMarkdownIntoBlocks } from 'streamdown'
import { getClientId } from '@/api/client'
import { Link } from '@tanstack/react-router'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SessionSnapshot } from '@/api/client'
import { TurnUsage, UsageFootnote } from '@/components/chat/chat-footnote'
import { KeySetupCard } from '@/components/chat/key-setup-card'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import {
  sendChatPrompt,
  isTurnForkable,
  isTurnTerminal,
  type ActivityRow as Activity,
  type Turn,
} from '@/lib/chat-store'
import { useShowActivity } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { CheckmarkIcon, CopyIcon } from '@/ui/primitives/icons'

// "1.0s" → "1s" — a trailing .0 carries no information.
const TRAILING_POINT_ZERO = /\.0$/

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000)
    return `${(ms / 1000).toFixed(1).replace(TRAILING_POINT_ZERO, '')}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

// Shell command as its own row under the activity label: one line, mono,
// horizontally scrollable (never ellipsized), click anywhere to copy.
function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number>(undefined)
  const copy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      className="group/cmd flex min-w-0 items-center gap-2 pl-3 text-left"
      onClick={copy}
      title="Copy command"
      type="button"
    >
      <code className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-fg-tertiary/70">
        {command}
      </code>
      {copied ? (
        <CheckmarkIcon className="size-3 shrink-0 text-accent-positive-highlight" />
      ) : (
        <CopyIcon className="size-3 shrink-0 text-fg-tertiary opacity-0 transition-opacity group-hover/cmd:opacity-100" />
      )}
    </button>
  )
}

// One line of agent activity (command run, file written…): dot, label,
// optional detail and duration chip — the quiet log strip between bubbles.
// Commands get their detail promoted to a CommandRow beneath the label.
// `live` (terminal loader) is the caller's call: only the tail row of a turn
// that is still streaming animates — finished turns render static dots.
function ActivityLine({ activity, live }: { activity: Activity; live?: boolean }) {
  const isError = activity.tone === 'error'
  const isLive = live === true
  const command =
    (activity.label === 'Finished command' ||
      activity.label === 'Running command') &&
    activity.detail
      ? activity.detail
      : null
  return (
    <div className="fade-up flex flex-col gap-1 px-1">
      <div
        className={cn(
          'flex items-baseline gap-2 text-label',
          isError ? 'text-accent-error-highlight' : 'text-fg-tertiary'
        )}
      >
        {isLive ? (
          <Loader className="shrink-0 text-xs" />
        ) : (
          <span className="size-1 shrink-0 translate-y-[-2px] bg-current opacity-40" />
        )}
        <span className="min-w-0 break-words">{activity.label}</span>
        {activity.agent_id && (
          <span className="min-w-0 truncate font-mono">
            {activity.agent_id === 'unknown' ? 'Attribution unknown' : activity.agent_id}
          </span>
        )}
        {activity.detail && !command ? (
          activity.linkChatId ? (
            // Fork provenance: the detail (sandbox id) links to the chat
            // running in that sandbox. Router Link, not <a href="?chat=">
            // — a full reload would kill streams running in other chats.
            <Link
              className="min-w-0 truncate font-mono underline decoration-current/40 underline-offset-2 transition-colors hover:text-fg-secondary"
              search={{ chat: activity.linkChatId }}
              to="/"
            >
              {activity.detail}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-fg-tertiary/70">
              {activity.detail}
            </span>
          )
        ) : null}
        {typeof activity.durationMs === 'number' && activity.durationMs >= 950 ? (
          <span className="shrink-0 text-[0.625rem] text-fg-tertiary/70 tabular-nums">
            {formatDuration(activity.durationMs)}
          </span>
        ) : null}
      </div>
      {command ? <CommandRow command={command} /> : null}
    </div>
  )
}

function PendingLine({ text }: { text: string }) {
  return (
    <div className="fade-up flex items-baseline gap-2 px-1 text-label text-fg-tertiary">
      <Loader className="shrink-0 text-xs" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-end">
      <div className="fade-up w-fit max-w-[min(80%,56ch)] overflow-hidden break-words border border-accent-main-highlight/25 bg-accent-main-bg px-3.5 py-2 text-[13px] leading-[1.65]">
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}

function AssistantBubble({ text, afterBlocks }: { text: string; afterBlocks?: ReadonlyMap<number, React.ReactNode> }) {
  return (
    <div className="message-fade-in w-full min-w-0 text-[13px] leading-[1.65]">
      <Markdown afterBlocks={afterBlocks}>{text}</Markdown>
    </div>
  )
}

function InterjectionView({ row, chatId }: { row: NonNullable<Turn['interjections']>[number]; chatId?: string }) {
  const pending = row.status === 'sending' || row.status === 'posted'
  if (row.status === 'became_turn' || (pending && row.text_offset == null)) return null
  const needsRetry = row.status === 'unconfirmed' || row.status === 'refused'
  return (
    <div className="space-y-1">
      {row.by !== getClientId() && <p className="text-right text-label text-fg-tertiary">Other viewer</p>}
      <UserBubble text={row.text} />
      {needsRetry || row.status === 'cancelled' ? (
        <div className="space-y-1 text-right text-label text-fg-tertiary">
          <p>{row.detail ?? (row.status === 'cancelled' ? 'Message cancelled.' : row.status === 'refused' ? 'Message was not delivered.' : 'Message delivery could not be confirmed.')}</p>
          {chatId && needsRetry && <Button variant="secondary" onClick={() => sendChatPrompt(chatId, row.text)}>Send as new prompt</Button>}
        </div>
      ) : null}
    </div>
  )
}

function TurnResponse({ turn, chatId }: { turn: Turn; chatId?: string }) {
  const characters = Array.from(turn.text)
  const length = characters.length
  let end = 0
  // Insert after the containing Markdown block so fences, lists, and links
  // remain intact. Keep one renderer for shared reference definitions.
  const ends = parseMarkdownIntoBlocks(turn.text).map((block) => {
    end += Array.from(block).length
    return end
  })
  const rows = (turn.interjections ?? [])
    .filter((row) => row.status !== 'became_turn')
    .toSorted((a, b) => (a.text_offset ?? length) - (b.text_offset ?? length))
  const before: React.ReactNode[] = []
  const afterBlocks = new Map<number, React.ReactNode[]>()
  for (const row of rows) {
    const offset = Math.min(length, row.text_offset ?? length)
    const view = <InterjectionView key={row.submission_id} row={row} chatId={chatId} />
    if (offset === 0 || ends.length === 0) {
      before.push(view)
      continue
    }
    // The block parser normalizes CRLF and CR to LF; archived offsets do not.
    const normalizedOffset = Array.from(characters.slice(0, offset).join('').replace(/\r\n?/g, '\n')).length
    const index = ends.findIndex((end) => end >= normalizedOffset)
    const block = index === -1 ? ends.length - 1 : index
    afterBlocks.set(block, [...(afterBlocks.get(block) ?? []), view])
  }
  return <>{before}{turn.text && <AssistantBubble text={turn.text} afterBlocks={afterBlocks} />}</>
}

function TurnView({
  turn,
  promptBy,
  chatId,
  isLast,
  onFork,
  forking,
  rootAgentOnly,
  usageDetails,
}: {
  turn: Turn
  promptBy?: string
  chatId?: string
  isLast: boolean
  /** Forks the chat on screen into a fresh sibling session. */
  onFork?: () => void
  forking?: boolean
  rootAgentOnly?: boolean
  usageDetails?: React.ReactNode
}) {
  const running = turn.outcome === 'running'
  const showActivity = useShowActivity()
  // Collapse back-to-back identical rows: the preview API sometimes emits the
  // same completion twice, and transcripts archived before the backend-side
  // dedupe carry those duplicates forever — hide them at render time.
  const activities = turn.activities.filter((activity, index) => {
    const prev = turn.activities[index - 1]
    return !(
      prev &&
      prev.tone === activity.tone &&
      prev.label === activity.label &&
      prev.detail === activity.detail &&
      prev.agent_id === activity.agent_id
    )
  })
  const grouped = activities.some(activity => activity.agent_id != null)
  const activityGroups = new Map<string | null, Activity[]>()
  for (const activity of activities) {
    const agentId = activity.agent_id ?? null
    const rows = activityGroups.get(agentId) ?? []
    rows.push(activity)
    activityGroups.set(agentId, rows)
  }
  const renderActivity = (activity: Activity, index: number) => (
    <ActivityLine
      activity={activity}
      key={activity.id ?? `row-${index}`}
      live={
        running &&
        !turn.phase &&
        (activity.tone === 'running' || activity.tone === 'turn') &&
        // Preserve the chronological tail rule when grouping id-less rows.
        (activity.id != null || activity === activities.at(-1))
      }
    />
  )
  return (
    <>
      {/* Prompt-less turns are system notes (fork provenance) — just the
          activity line, no empty user bubble. */}
      {turn.prompt ? <div className="space-y-1">
        {promptBy && promptBy !== getClientId() && <p className="text-right text-label text-fg-tertiary">Other viewer</p>}
        <UserBubble text={turn.prompt} />
      </div> : null}
      {showActivity && (grouped ? (
        Array.from(activityGroups, ([agentId, rows]) => {
          const label = agentId === 'unknown' ? 'Attribution unknown'
            : agentId ? `Subagent ${agentId}` : 'Root agent'
          return (
            <div aria-label={label} className="flex min-w-0 flex-col gap-3 border-l border-stroke pl-3" key={agentId ?? 'root'} role="group">
              <div className="text-label text-fg-tertiary">{label}</div>
              {rows.map(renderActivity)}
            </div>
          )
        })
      ) : activities.map(renderActivity))}
      {turn.phase ? <PendingLine text={`${turn.phase}…`} /> : null}
      {/* With the log hidden, a streaming turn with no text yet would render
          nothing at all — keep one live line as feedback. */}
      {!showActivity && running && !turn.phase && !turn.text ? (
        <PendingLine text="working…" />
      ) : null}
      {turn.reasoning != null ? (
        <details key={chatId} className="min-w-0 text-[13px] text-fg-secondary leading-[1.65]">
          <summary className="cursor-pointer text-label">Reasoning</summary>
          <div className="pt-2"><Markdown>{turn.reasoning}</Markdown></div>
        </details>
      ) : null}
      <TurnResponse turn={turn} chatId={chatId} />
      {turn.outcome === 'error' &&
      turn.errorCode === 'missing_keys' &&
      chatId ? (
        // Missing credentials read as a conversation, not a failure: the
        // error line plus an inline setup card with get-a-key links.
        <>
          <ActivityLine
            activity={{
              tone: 'error',
              label: turn.error ?? 'API keys are missing.',
            }}
          />
          <KeySetupCard chatId={chatId} prompt={turn.prompt} retry={isLast} />
        </>
      ) : isTurnForkable(turn) ? (
        // Backend-authoritative recovery capability: transient upstream 500s
        // may offer a fork while retries remain valid; terminal decay/expiry
        // uses the same action while the composer is locked below.
        <>
          <ActivityLine
            activity={{
              tone: 'error',
              label: turn.error ?? 'The session decayed upstream.',
            }}
          />
          {isLast && onFork && !isTurnTerminal(turn) ? (
            <div>
              <Button disabled={forking} onClick={onFork} variant="secondary">
                {forking ? <Loader /> : null}
                {forking ? 'Recovering…' : 'Fork to continue'}
              </Button>
            </div>
          ) : null}
        </>
      ) : turn.outcome === 'error' ? (
        <ActivityLine
          activity={{ tone: 'error', label: turn.error ?? 'The turn failed.' }}
        />
      ) : null}
      <TurnUsage rootAgentOnly={rootAgentOnly} turn={turn} />
      {showActivity && !running && (turn.prompt || turn.upstreamTurnId) ? usageDetails : null}
      {turn.outcome === 'cancelled' ? (
        <ActivityLine activity={{ tone: 'muted', label: 'turn cancelled' }} />
      ) : null}
    </>
  )
}

/** Imperative surface for the composer's scroll-to-bottom button. */
export type TranscriptHandle = {
  scrollToBottom: () => void
}

// The scrolling conversation column: centered max-w-3xl, follows the stream
// while the user sits at the bottom. The scroll-to-bottom button lives in the
// composer and reaches in through the `ref` handle.
export function Transcript({
  turns,
  empty,
  sessionKey,
  onAtBottomChange,
  onFork,
  forking,
  rootAgentOnly,
  snapshot,
  sessionId,
  ref,
}: {
  turns: Turn[]
  empty?: React.ReactNode
  /** Identity of the chat on screen — switching it re-engages follow. */
  sessionKey?: string
  /** Fires when the reader crosses the bottom threshold — drives the
      composer's scroll-to-bottom button visibility. */
  onAtBottomChange?: (atBottom: boolean) => void
  /** Forks the on-screen chat when backend marks its workspace recoverable. */
  onFork?: () => void
  forking?: boolean
  rootAgentOnly?: boolean
  snapshot?: SessionSnapshot
  sessionId?: string | null
  ref?: React.Ref<TranscriptHandle>
}) {
  const submissionPosters = new Map(turns.flatMap((turn) =>
    (turn.interjections ?? []).map((row) => [row.submission_id, row.by] as const)
  ))
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  // Latest-ref for the callback so scroll handlers never go stale; written in
  // an effect (not render) so replayed/discarded renders stay pure.
  const notifyRef = useRef(onAtBottomChange)
  useLayoutEffect(() => {
    notifyRef.current = onAtBottomChange
  })

  // Plain function — the React Compiler stabilizes its identity (the
  // closure holds only refs), so no useCallback and no effect-deps entries.
  const setAtBottom = (atBottom: boolean) => {
    if (atBottomRef.current !== atBottom) {
      notifyRef.current?.(atBottom)
    }
    atBottomRef.current = atBottom
  }

  // True while a programmatic smooth scroll is in flight. Its own scroll
  // events read as "away from the bottom" (especially with content still
  // streaming in underneath) — without the flag the handler would disengage
  // follow mid-animation and strand the reader at the stale target.
  const animatingRef = useRef(false)

  // Last seen scrollTop — separates "the user scrolled up" (scrollTop
  // decreased) from "content grew underneath" (scrollTop unchanged, height
  // up). Async markdown commits (Streamdown parses off the render pass) land
  // right after a chat-switch snap; reading that as leaving the bottom would
  // disengage follow and strand the reader mid-transcript.
  const lastTopRef = useRef(0)

  // Chat-switch settling window. Right after the snap below, Streamdown
  // re-renders its markdown and the column transiently SHRINKS — the browser
  // clamps scrollTop to the shorter content and by the time that scroll
  // event is delivered the height is restored, so it reads exactly like a
  // user scroll-up (top dropped, height stable). No event-time heuristic can
  // tell them apart. While the window is open, any off-bottom position is
  // treated as a layout artifact and re-pinned; real intent (wheel/touch)
  // closes the window instantly.
  const pinUntilRef = useRef(0)

  // Switching chats lands at the bottom with follow re-engaged. Any smooth
  // scroll still "in flight" died with the old chat — clear the flag, or the
  // ResizeObserver re-pin below stays disabled and the settling-window
  // repairs get skipped as "mid-animation".
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    animatingRef.current = false
    el.scrollTop = el.scrollHeight
    lastTopRef.current = el.scrollTop
    pinUntilRef.current = performance.now() + 1000
    setAtBottom(true)
    // The chat identity is the one real trigger; setAtBottom is
    // compiler-stable and deliberately not a dep.
  }, [sessionKey])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    const movedUp = el.scrollTop < lastTopRef.current
    lastTopRef.current = el.scrollTop
    if (animatingRef.current) {
      // Mid-animation positions don't count as user intent; arrival does.
      if (atBottom) {
        animatingRef.current = false
        setAtBottom(true)
      }
      return
    }
    if (atBottom) {
      setAtBottom(true)
      return
    }
    if (performance.now() < pinUntilRef.current) {
      // Settling window: an off-bottom position this soon after a chat
      // switch is the Streamdown shrink-clamp artifact — repair the pin.
      el.scrollTop = el.scrollHeight
      lastTopRef.current = el.scrollTop
      setAtBottom(true)
      return
    }
    if (movedUp) {
      setAtBottom(false)
    }
    // Not at bottom without moving up = content grew below the pin — keep
    // follow engaged; the ResizeObserver re-pin catches the next growth.
  }

  // Disengage follow on the user's *intent*, not just position: scroll events
  // coalesce, so a mid-stream snap-to-bottom can land before the handler ever
  // sees the user's upward wheel — eating it. Wheel-up and an upward touch
  // drag break follow immediately; scrolling back down past the threshold
  // (handleScroll) re-engages it.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const cancel = () => {
      animatingRef.current = false
      pinUntilRef.current = 0 // real intent overrides the settling window
      setAtBottom(false)
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) cancel()
    }
    let touchY = 0
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0
      // Finger moving down drags the content down = scrolling up.
      if (y - touchY > 4) cancel()
      touchY = y
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      // Mount-once listeners; setAtBottom is compiler-stable, not a dep.
    }
  }, [])

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current
    if (!el) {
      return
    }
    if (behavior === 'smooth') {
      // Zero-distance smooth scrolls fire no scroll event, so an "animating"
      // flag set here would never see its arrival and stick forever — only
      // arm it when there is actual distance to travel.
      animatingRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight > 1
    }
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  // The imperative jump (scroll-down button, own send) also re-engages
  // follow: a lone smooth scroll lands short while content keeps streaming —
  // flipping atBottom first lets the follow effect hold the pin from there.
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      setAtBottom(true)
      scrollToBottom()
    },
  }))

  // Hold the bottom pin through *async* content growth. The chat-switch
  // effect above snaps to the bottom once, but Streamdown highlights code
  // (shiki) after first paint — the column grows and a one-shot pin lands
  // the reader mid-transcript, as if the chat "remembered" an old scroll
  // position. While follow is engaged, every content resize re-pins.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (
        el &&
        (atBottomRef.current || performance.now() < pinUntilRef.current) &&
        !animatingRef.current
      ) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // Follow the stream while the user is at the bottom. Reads the ref so a
  // queued effect never acts on a stale position.
  const last = turns.at(-1)
  const followKey = last
    ? `${last.id}:${last.text.length}:${last.activities.length}:${last.phase ?? ''}:${last.outcome}`
    : ''
  useEffect(() => {
    if (atBottomRef.current) {
      scrollToBottom('auto')
    }
    // followKey is the real trigger; scrollToBottom is compiler-stable.
  }, [followKey])

  return (
    <div className="relative min-h-0 flex-1 bg-bg">
      {turns.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          {empty}
        </div>
      )}
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto"
        onScroll={handleScroll}
        ref={containerRef}
      >
        <div
          className="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col gap-4 px-4 py-6 md:gap-5"
          ref={contentRef}
        >
          {turns.map((turn, index) => (
            <TurnView
              rootAgentOnly={rootAgentOnly}
              chatId={sessionKey}
              isLast={index === turns.length - 1}
              forking={forking}
              key={turn.id}
              onFork={onFork}
              turn={turn}
              usageDetails={
                <UsageFootnote
                  sessionId={sessionId}
                  snapshot={snapshot}
                  turns={turns.slice(0, index + 1)}
                />
              }
              promptBy={turn.from_submission_id ? submissionPosters.get(turn.from_submission_id) : undefined}
            />
          ))}
          <div className="min-h-[24px] min-w-[24px] shrink-0" />
        </div>
      </div>
    </div>
  )
}
