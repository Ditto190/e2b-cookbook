import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  type PanelSide,
  setMobilePanelOpen,
  setPanelOpen,
  setPanelWidth,
  toggleMobilePanel,
  togglePanel,
  useMobilePanelOpen,
  usePanelOpen,
  usePanelWidth,
} from '@/lib/panels'
import { railDragHandler } from '@/lib/rail-drag'
import { cn } from '@/lib/utils'
import { CollapseLeftIcon, ExpandRightIcon } from '@/ui/primitives/icons'

// Header button toggling a panel. Reads the shared panels store, so it can
// sit anywhere (the chat header) while the panel is a layout sibling.
export function PanelTrigger({
  side,
  className,
  onClick,
  ...props
}: { side: PanelSide } & ComponentProps<typeof Button>) {
  const Icon = side === 'left' ? CollapseLeftIcon : ExpandRightIcon
  const isMobile = useIsMobile()
  const desktopOpen = usePanelOpen(side)
  const mobileOpen = useMobilePanelOpen(side)
  // Icon reads as the action: as-drawn = collapse (panel open), flipped 180°
  // = expand (panel closed). Rotation eases in step with the panel slide.
  const open = isMobile ? mobileOpen : desktopOpen
  return (
    <Button
      className={className}
      data-slot="panel-trigger"
      onClick={(event) => {
        onClick?.(event)
        // On mobile the panel is an overlay drawer with its own open state —
        // the persisted desktop open/width pair is left untouched.
        if (isMobile) {
          toggleMobilePanel(side)
        } else {
          togglePanel(side)
        }
      }}
      // icon-sm matches the theme/activity toggles sharing the header row.
      size="icon-sm"
      variant="quaternary"
      {...props}
    >
      {/* !important: the Button's [&_svg]:transition-colors outranks a plain
          utility on the icon itself, so the property list is forced here —
          color stays included to keep the hover fade. */}
      <Icon
        className={cn(
          '!transition-[color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          !open && 'rotate-180'
        )}
      />
      <span className="sr-only">Toggle {side} panel</span>
    </Button>
  )
}

// Invisible strip over the gap on the panel's inner edge. Click = toggle;
// drag = live resize. During the drag the width var is written straight to
// the panel element — no React re-render per pointer move — and
// data-dragging suppresses the width transition.
const panelOf = (rail: HTMLElement) =>
  rail.closest('[data-slot=side-panel]') as HTMLElement | null

function PanelRail({ side }: { side: PanelSide }) {
  const open = usePanelOpen(side)
  const width = usePanelWidth(side)

  const handlePointerDown = railDragHandler({
    side,
    onDragStart: (rail) => {
      const panel = panelOf(rail)
      if (panel) {
        panel.dataset.dragging = 'true'
      }
      setPanelOpen(side, true)
    },
    onLiveWidth: (px, rail) => {
      panelOf(rail)?.style.setProperty('--panel-width', `${px}px`)
    },
    onDragEnd: (rail) => {
      const panel = panelOf(rail)
      if (panel) {
        delete panel.dataset.dragging
      }
    },
    onCommit: (px) => setPanelWidth(side, px),
    onCollapse: (rail) => {
      // Restore the committed width so reopening doesn't come back tiny.
      panelOf(rail)?.style.setProperty('--panel-width', width)
      setPanelOpen(side, false)
    },
    onToggle: () => togglePanel(side),
  })

  return (
    <div
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 overflow-visible sm:block',
        side === 'left' ? '-right-4' : '-left-4'
      )}
      data-slot="side-panel-rail"
    >
      <button
        aria-label={`Toggle ${side} panel`}
        className={cn(
          'absolute inset-y-0 left-0 w-4 touch-none',
          side === 'left'
            ? open
              ? 'cursor-w-resize'
              : 'cursor-e-resize'
            : open
              ? 'cursor-e-resize'
              : 'cursor-w-resize'
        )}
        onPointerDown={handlePointerDown}
        tabIndex={-1}
        type="button"
      />
    </div>
  )
}

// Collapsible, rail-resizable side panel. In-flow width animation; the
// negative margin on collapse swallows the layout's gap-2 so a closed panel
// leaves no double gutter. Fixed inner width so content doesn't reflow
// mid-animation.
export function SidePanel({
  side,
  className,
  children,
}: {
  side: PanelSide
  className?: string
  children: ReactNode
}) {
  const open = usePanelOpen(side)
  const width = usePanelWidth(side)
  const isMobile = useIsMobile()
  const mobileOpen = useMobilePanelOpen(side)

  // Mobile: the panel leaves the flow entirely and becomes an offcanvas
  // drawer over the chat (the shadcn sidebar Sheet pattern, hand-rolled).
  // Kept mounted so the slide transition runs both ways; inert when closed.
  if (isMobile) {
    return (
      <>
        <button
          aria-label={`Close ${side} panel`}
          className={cn(
            'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setMobilePanelOpen(side, false)}
          tabIndex={-1}
          type="button"
        />
        <div
          className={cn(
            'fixed inset-y-0 z-50 w-72 bg-bg-1 shadow-[var(--shadow-float)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            side === 'left'
              ? 'left-0 border-stroke border-r'
              : 'right-0 border-stroke border-l',
            mobileOpen
              ? 'translate-x-0'
              : side === 'left'
                ? '-translate-x-full'
                : 'translate-x-full'
          )}
          data-slot="side-panel"
          data-state={mobileOpen ? 'expanded' : 'collapsed'}
        >
          {children}
        </div>
      </>
    )
  }

  return (
    <div
      className={cn('group/side-panel relative shrink-0', className)}
      data-slot="side-panel"
      data-state={open ? 'expanded' : 'collapsed'}
      style={
        {
          '--panel-width': width,
        } as CSSProperties
      }
    >
      {/* Width animation lives one level down so the rail (absolutely
          positioned outside the panel) escapes the overflow clip. */}
      <div
        className={cn(
          'group-data-[dragging=true]/side-panel:!transition-none h-full overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          open
            ? 'w-(--panel-width)'
            : cn('w-0', side === 'left' ? '-mr-2' : '-ml-2')
        )}
      >
        <div className="h-full w-(--panel-width)">{children}</div>
      </div>
      <PanelRail side={side} />
    </div>
  )
}
