import { Button } from '@/components/ui/button'
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUpIcon, FileIcon, StoppedIcon } from '@/ui/primitives/icons'

const AUTO_GROW_MAX_FRACTION = 0.4
// The top-rail drag can pull the input taller than auto-grow ever would.
const DRAG_MAX_FRACTION = 0.6
const MENTION_MAX_MATCHES = 8

// One class string shared by the textarea and its highlight mirror — the
// mirror only lines up with the real text if every metric (font, padding,
// wrapping) matches exactly.
// `block`: an inline-level textarea leaves a baseline gap under itself that
// would grow the card past the min-height it shares with the sidebar and the
// drop zone (see the <form> below).
const TEXTAREA_TYPOGRAPHY =
  'block min-h-[clamp(3rem,20vw,6rem)] w-full whitespace-pre-wrap [overflow-wrap:break-word] px-[clamp(0.75rem,3vw,1rem)] pt-[clamp(0.625rem,2.5vw,0.875rem)] pb-1.5 text-body leading-relaxed'

/** Mirror layer behind the textarea: transparent text with an info-tinted box
 * painted behind every token that is a real workspace file reference, so a
 * picked "@file" reads as a chip rather than plain prompt text. */
function MentionHighlights({
  text,
  files,
}: {
  text: string
  files: Set<string>
}) {
  // Keyed by each segment's character offset — stable for everything before
  // an edit point, unlike array indexes (raw string segments need no key).
  // Plain loop, not .map with a captured counter: reassigning a variable
  // inside a closure makes the React Compiler bail out of this component.
  const nodes: React.ReactNode[] = []
  let offset = 0
  for (const segment of text.split(/(@\S+)/g)) {
    const start = offset
    offset += segment.length
    nodes.push(
      segment.startsWith('@') && files.has(segment.slice(1)) ? (
        <mark
          className="bg-accent-info-bg text-transparent shadow-[inset_0_-1px_0_var(--accent-info-highlight)]"
          key={start}
        >
          {segment}
        </mark>
      ) : (
        segment
      )
    )
  }
  return (
    <>
      {nodes}
      {/* Trailing newline keeps the mirror's last line box alive so its
          scrollHeight matches the textarea's. */}
      {'\n'}
    </>
  )
}

/** The "@" the caret is currently inside, if any: an @ at a word boundary
 * with no whitespace between it and the caret. */
function activeMention(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const at = text.lastIndexOf('@', caret - 1)
  if (at === -1) return null
  if (at > 0 && !/\s/.test(text[at - 1] ?? '')) return null
  const query = text.slice(at + 1, caret)
  if (/\s/.test(query)) return null
  return { start: at, query }
}

// The composer shell: flat E2B card (sharp corners, hairline stroke that
// sharpens to stroke-active on focus), auto-growing textarea on top, tools
// row below, and the send button in the bottom-right slot. While a turn is
// streaming, Enter and Send queue; Cmd+Enter steers. Stop stays separate.
export function Composer({
  onSend,
  onSteer,
  onSteerQueued,
  onCancel,
  streaming,
  disabled,
  placeholder = 'Ask anything...',
  tools,
  mentionFiles,
}: {
  onSend: (text: string) => void
  onSteer?: (text: string) => void | Promise<void>
  onSteerQueued?: () => void
  onCancel?: () => void
  streaming?: boolean
  disabled?: boolean
  placeholder?: string
  tools?: React.ReactNode
  /** Workspace-relative file paths behind the "@" mention picker; empty or
   * omitted leaves the feature inert. */
  mentionFiles?: string[]
}) {
  const [input, setInput] = useState('')
  // User-dragged floor for the textarea height (the composer's top rail).
  // null = never dragged; the CSS clamp() min-height governs alone, so the
  // composer stays responsive-small on phones until the user pulls it up.
  const [minHeight, setMinHeight] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // "@" file mention picker — the caret position drives which mention (if
  // any) is active; onChange and onSelect both keep it current.
  const highlightsRef = useRef<HTMLDivElement>(null)
  // No useMemo — the compiler caches this keyed on mentionFiles.
  const mentionSet = new Set(mentionFiles ?? [])
  const [caret, setCaret] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const mention = mentionDismissed ? null : activeMention(input, caret)
  const matches =
    mention && mentionFiles && mentionFiles.length > 0
      ? mentionFiles
          .filter((path) =>
            path.toLowerCase().includes(mention.query.toLowerCase())
          )
          .slice(0, MENTION_MAX_MATCHES)
      : []
  const mentionOpen = mention !== null && matches.length > 0
  const highlightedIndex = Math.min(highlighted, matches.length - 1)

  // New query → highlight back to the top row. Adjusted during render (the
  // React-endorsed "adjusting state when props change" pattern) instead of
  // an effect, so there's no extra commit chasing the keystroke.
  const [prevQuery, setPrevQuery] = useState<string | null>(null)
  const query = mention?.query ?? null
  if (query !== prevQuery) {
    setPrevQuery(query)
    setHighlighted(0)
  }

  const pickMention = (path: string) => {
    if (!mention) return
    const inserted = `@${path} `
    setInput(input.slice(0, mention.start) + inserted + input.slice(caret))
    setMentionDismissed(false)
    const nextCaret = mention.start + inserted.length
    // The caret move must land after React commits the new value.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
        setCaret(nextCaret)
      }
    })
  }

  // Auto-grow the textarea to fit content (reset-to-auto, then scrollHeight,
  // capped). useLayoutEffect so the height lands before paint. Empty input
  // clears the inline height entirely — otherwise a mount-time mismeasure
  // can freeze the empty textarea at the cap.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!input && minHeight === null) {
      el.style.height = ''
      return
    }
    el.style.height = 'auto'
    // scrollHeight already respects the CSS clamp() min-height, so the
    // responsive floor holds without a JS mirror of the clamp value.
    const target = Math.min(
      el.scrollHeight,
      window.innerHeight * AUTO_GROW_MAX_FRACTION
    )
    el.style.height = `${Math.max(target, minHeight ?? 0)}px`
  }, [input, minHeight])

  // Composer top rail: drag up = taller input, mirroring the side panels'
  // rail-resize affordance. Commits a height floor auto-grow can't shrink
  // below; double the auto-grow cap is the ceiling.
  const startResize = (event: React.PointerEvent) => {
    const el = textareaRef.current
    if (!el) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = el.offsetHeight
    // Drag floor bottoms out at the responsive CSS min-height, not a fixed px.
    const cssMin = Number.parseFloat(getComputedStyle(el).minHeight) || 0
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight + (startY - move.clientY), cssMin),
        window.innerHeight * DRAG_MAX_FRACTION
      )
      setMinHeight(Math.round(next))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const submit = (steer = false) => {
    if (disabled) return
    const text = input.trim()
    if (!text) {
      if (steer && streaming) onSteerQueued?.()
      return
    }
    setInput('')
    if (steer && streaming && onSteer) {
      void onSteer(text)
    } else {
      onSend(text)
    }
    textareaRef.current?.focus()
  }

  return (
    // The card is at least as tall as the workspace drop zone (same clamp, see
    // WorkspacePane) and the sidebar's bottom block is sized to it (see
    // AppSidebar): three top edges on one line. Slack goes under the textarea
    // (flex-1 wrapper), so the toolbar keeps its bottom and the placeholder
    // its top.
    <form
      className="relative flex min-h-[clamp(6rem,24vw,9.25rem)] flex-col border border-stroke bg-bg-1 focus-within:border-stroke-active"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {/* Invisible resize rail across the card's top edge (same affordance
          as the side panels' rails). */}
      <div
        aria-hidden
        className="-top-1 absolute inset-x-0 z-10 h-2 cursor-n-resize touch-none"
        onPointerDown={startResize}
      />
      {/* "@" mention dropdown — same card recipe as the model selector popup,
          anchored above the composer. Rendered inline (not a popover) so the
          textarea never loses focus while picking. */}
      {mentionOpen && (
        <div className="absolute bottom-full left-3 z-20 mb-2 w-[min(320px,calc(100%-1.5rem))] overflow-hidden border border-stroke bg-bg-1 shadow-[var(--shadow-float)]">
          <p className="px-2 pt-2 pb-1.5 text-label text-fg-tertiary">
            Workspace files
          </p>
          <div className="max-h-[240px] overflow-y-auto p-1 pt-0">
            {matches.map((path, index) => (
              <button
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                  index === highlightedIndex && 'bg-fill'
                )}
                key={path}
                // onMouseDown, not onClick: a click's mousedown would blur
                // the textarea and close the menu before click ever fires.
                onMouseDown={(event) => {
                  event.preventDefault()
                  pickMention(path)
                }}
                onMouseMove={() => setHighlighted(index)}
                type="button"
              >
                <FileIcon className="size-3.5 shrink-0 text-icon-secondary" />
                <span className="truncate">{path}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative flex-1">
        {/* Behind the textarea (which is position:relative, so its text
            paints on top); scroll-synced from the textarea's onScroll. */}
        <div
          aria-hidden
          className={cn(
            TEXTAREA_TYPOGRAPHY,
            'pointer-events-none absolute inset-0 overflow-hidden text-transparent'
          )}
          ref={highlightsRef}
        >
          <MentionHighlights files={mentionSet} text={input} />
        </div>
      <textarea
        className={cn(
          TEXTAREA_TYPOGRAPHY,
          'relative resize-none overflow-y-auto bg-transparent outline-none placeholder:text-fg-tertiary disabled:opacity-50'
        )}
        disabled={disabled}
        onChange={(event) => {
          setInput(event.target.value)
          setCaret(event.target.selectionStart ?? 0)
          setMentionDismissed(false)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && event.metaKey && !event.shiftKey) {
            event.preventDefault()
            if (!event.repeat) submit(true)
            return
          }
          if (mentionOpen) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlighted((index) => (index + 1) % matches.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted(
                (index) => (index - 1 + matches.length) % matches.length
              )
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const picked = matches[highlightedIndex]
              if (picked !== undefined) pickMention(picked)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionDismissed(true)
              return
            }
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        onScroll={(event) => {
          // The mirror can't scroll itself — chase the textarea.
          if (highlightsRef.current) {
            highlightsRef.current.scrollTop = event.currentTarget.scrollTop
          }
        }}
        onSelect={(event) =>
          setCaret(event.currentTarget.selectionStart ?? 0)
        }
        placeholder={placeholder}
        ref={textareaRef}
        rows={2}
        value={input}
      />
      </div>
      <div className="flex items-center justify-between gap-2 px-[clamp(0.5rem,2vw,0.75rem)] pb-[clamp(0.5rem,2vw,0.75rem)]">
        {/* The pill row is wider than a phone — scroll it instead of letting
            it shove the send button off the card. */}
        <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {tools}
        </div>
        {/* size="icon" is h-9; the clamp shrinks it toward 28px on phones,
            matching the config pills' responsive height. */}
        <div className="flex shrink-0 items-center gap-2">
        {streaming ? (
          <Button
            aria-label="Stop the turn"
            className="size-[clamp(1.75rem,8vw,2.25rem)] p-0"
            onClick={onCancel}
            size="icon"
            type="button"
            variant="secondary"
          >
            <StoppedIcon />
          </Button>
        ) : null}
        {!streaming || onSteer ? (
          <Button
            aria-label={streaming ? 'Queue message' : 'Send message'}
            title={streaming && onSteer ? 'Queue message (Enter). Steer now (⌘Enter).' : undefined}
            className="size-[clamp(1.75rem,8vw,2.25rem)] p-0"
            disabled={!input.trim() || disabled}
            size="icon"
            type="submit"
            variant="primary"
          >
            <ArrowUpIcon />
          </Button>
        ) : null}
        </div>
      </div>
    </form>
  )
}
