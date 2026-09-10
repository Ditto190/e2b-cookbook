import type { SessionSnapshot } from '@/api/client'
import { ApiKeySettings } from '@/components/api-key-settings'
import { InviteButton } from '@/components/invite-button'
import { SessionControls } from '@/components/session-controls'
import { PanelTrigger } from '@/components/side-panel'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { setShowActivity, useShowActivity } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { ListIcon } from '@/ui/primitives/icons'

// Header toggle for the transcript's activity log lines (the quiet
// session.turn.* narration between bubbles). On = filled chip (the same
// treatment as an open ⋮ menu) so the state reads at a glance; off = the
// plain dimmed glyph.
function ActivityToggle() {
  const show = useShowActivity()
  return (
    <Button
      aria-pressed={show}
      className={cn(
        // Light fill + full-strength glyph when on; plain tertiary glyph
        // when off — state carried by the fill, not by ghosting.
        show
          ? 'bg-fill-highlight/40 text-fg [&_svg]:text-fg'
          : 'text-fg-tertiary [&_svg]:text-fg-tertiary'
      )}
      onClick={() => setShowActivity(!show)}
      size="icon-sm"
      title={show ? 'Hide agent activity log' : 'Show agent activity log'}
      variant="quaternary"
    >
      <ListIcon />
      <span className="sr-only">Toggle agent activity log</span>
    </Button>
  )
}

// Header strip over the chat panel: upstream status chips in the
// session-header chip style, theme + activity toggles in the right cluster.
// The app title and partner lockup live in the sidebar footer.
export function WorkbenchHeader({
  snapshot,
  hostKeyMissing,
  resuming,
  pausing,
  viewExpired,
  onPause,
  onResume,
}: {
  snapshot: SessionSnapshot | undefined
  hostKeyMissing: boolean
  resuming: boolean
  pausing: boolean
  viewExpired: boolean
  onPause: () => void
  onResume: () => void
}) {
  return (
    // Three-column grid: the side columns share the leftover width equally
    // (so the lifecycle cluster sits on the true centerline) but never shrink
    // below their own content, so a wide right cluster nudges the center
    // instead of overlapping it. A flow mx-auto would drift toward the
    // narrower side; a fixed-breakpoint absolute center wrapped the cluster
    // onto its own row at widths that still had plenty of room. Below 30rem
    // the cluster takes a full second row.
    <header className="@container grid min-h-12 shrink-0 grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 border-stroke border-b px-3 py-2">
      <div className="flex items-center justify-self-start">
        <PanelTrigger side="left" />
      </div>
      {/* The sandbox id chip is gone — the sidebar rows carry it. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 @max-[30rem]:col-span-3 @max-[30rem]:row-start-2">
        {viewExpired && (
          <span className="whitespace-nowrap border border-stroke bg-fill px-2 py-0.5 text-[11px] text-fg-tertiary">
            expired · read-only
          </span>
        )}
        <SessionControls
          onPause={onPause}
          onResume={onResume}
          pausing={pausing}
          resuming={resuming}
          snapshot={snapshot}
        />
        {hostKeyMissing && (
          <span className="whitespace-nowrap border border-accent-error-highlight/40 bg-accent-error-bg px-2 py-0.5 text-[11px] text-accent-error-highlight">
            no host key
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 justify-self-end @max-[30rem]:col-start-3">
        <InviteButton />
        <ApiKeySettings />
        <ThemeToggle />
        <ActivityToggle />
        <PanelTrigger side="right" />
      </div>
    </header>
  )
}
