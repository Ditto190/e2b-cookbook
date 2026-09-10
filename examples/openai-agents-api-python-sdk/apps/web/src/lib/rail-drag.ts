import type { PointerEvent as ReactPointerEvent } from 'react'

// Click-vs-drag discrimination for sidebar rails: press and release in
// place toggles the panel (the rail's historic behavior); moving past the
// slop threshold turns the gesture into a live resize. Callbacks get the
// rail element so callers can walk to their panel and write CSS vars
// directly during the drag (frame-synced, no React re-render per move).
const DRAG_SLOP_PX = 5
const MIN_WIDTH_PX = 192
const MAX_WIDTH_FRACTION = 0.4
const COLLAPSE_BELOW_PX = 120

export function railDragHandler({
  side,
  onDragStart,
  onLiveWidth,
  onDragEnd,
  onCommit,
  onCollapse,
  onToggle,
}: {
  side: 'left' | 'right'
  // First movement past the slop — open the panel if collapsed, kill
  // width transitions.
  onDragStart: (rail: HTMLElement) => void
  onLiveWidth: (px: number, rail: HTMLElement) => void
  // Always called after a drag, before commit/collapse — restore
  // transitions.
  onDragEnd: (rail: HTMLElement) => void
  onCommit: (px: number, rail: HTMLElement) => void
  // Released with the pointer near the screen edge — hide the panel.
  onCollapse: (rail: HTMLElement) => void
  onToggle: () => void
}) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }
    const rail = event.currentTarget
    const startX = event.clientX
    let dragged = false
    rail.setPointerCapture(event.pointerId)

    const widthAt = (clientX: number) =>
      side === 'left' ? clientX : window.innerWidth - clientX
    const clamp = (raw: number) =>
      Math.min(
        Math.max(raw, MIN_WIDTH_PX),
        window.innerWidth * MAX_WIDTH_FRACTION
      )

    const onMove = (ev: globalThis.PointerEvent) => {
      if (!dragged) {
        if (Math.abs(ev.clientX - startX) < DRAG_SLOP_PX) {
          return
        }
        dragged = true
        onDragStart(rail)
      }
      onLiveWidth(clamp(widthAt(ev.clientX)), rail)
    }
    const finish = (ev: globalThis.PointerEvent) => {
      rail.removeEventListener('pointermove', onMove)
      rail.removeEventListener('pointerup', finish)
      rail.removeEventListener('pointercancel', finish)
      if (!dragged) {
        onToggle()
        return
      }
      onDragEnd(rail)
      const raw = widthAt(ev.clientX)
      if (raw < COLLAPSE_BELOW_PX) {
        onCollapse(rail)
      } else {
        onCommit(clamp(raw), rail)
      }
    }
    rail.addEventListener('pointermove', onMove)
    rail.addEventListener('pointerup', finish)
    rail.addEventListener('pointercancel', finish)
  }
}
