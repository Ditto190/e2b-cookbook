// Persisted open/width state for the two workbench side panels — chats on
// the left, workspace on the right. localStorage-backed, live-updating
// (same store shape as settings.ts). State lives at module scope so the
// panels and the header triggers stay in sync without a context provider.
import { useSyncExternalStore } from 'react'

export type PanelSide = 'left' | 'right'

const key = (side: PanelSide, what: 'open' | 'width') =>
  `agents-api-workbench-panel-${side}-${what}`

const DEFAULT_WIDTH: Record<PanelSide, string> = {
  left: '15rem',
  right: '24rem',
}

const state: Record<PanelSide, { open: boolean; width: string }> = {
  left: {
    open: localStorage.getItem(key('left', 'open')) !== 'closed',
    width: localStorage.getItem(key('left', 'width')) ?? DEFAULT_WIDTH.left,
  },
  right: {
    open: localStorage.getItem(key('right', 'open')) !== 'closed',
    width: localStorage.getItem(key('right', 'width')) ?? DEFAULT_WIDTH.right,
  },
}

// Mobile drawer state — separate from the desktop open/width pair (shadcn
// sidebar's openMobile split): session-only, never persisted, so a phone
// always loads with the drawer closed and the chat full-width.
const mobileOpen: Record<PanelSide, boolean> = { left: false, right: false }

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

export function usePanelOpen(side: PanelSide): boolean {
  return useSyncExternalStore(subscribe, () => state[side].open)
}

/** Committed panel width as a CSS length (live drag bypasses the store). */
export function usePanelWidth(side: PanelSide): string {
  return useSyncExternalStore(subscribe, () => state[side].width)
}

export function setPanelOpen(side: PanelSide, open: boolean) {
  state[side] = { ...state[side], open }
  localStorage.setItem(key(side, 'open'), open ? 'open' : 'closed')
  notify()
}

export function togglePanel(side: PanelSide) {
  setPanelOpen(side, !state[side].open)
}

export function setPanelWidth(side: PanelSide, px: number) {
  state[side] = { ...state[side], width: `${Math.round(px)}px` }
  localStorage.setItem(key(side, 'width'), state[side].width)
  notify()
}

export function useMobilePanelOpen(side: PanelSide): boolean {
  return useSyncExternalStore(subscribe, () => mobileOpen[side])
}

export function setMobilePanelOpen(side: PanelSide, open: boolean) {
  mobileOpen[side] = open
  notify()
}

export function toggleMobilePanel(side: PanelSide) {
  setMobilePanelOpen(side, !mobileOpen[side])
}
