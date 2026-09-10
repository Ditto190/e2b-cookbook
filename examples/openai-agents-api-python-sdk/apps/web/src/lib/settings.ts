// Tiny persisted UI settings store (localStorage-backed, live-updating).
import { useSyncExternalStore } from 'react'

const AUTOPAUSE_KEY = 'agents-api-workbench-autopause'

let autoPause = localStorage.getItem(AUTOPAUSE_KEY) === 'on'
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

/** Snapshot the chat's sandbox right after every turn. Default off —
 * sandboxes otherwise run out their idle TTL and auto-pause on E2B's side. */
export function useAutoPause(): boolean {
  return useSyncExternalStore(subscribe, () => autoPause)
}

/** Non-hook read for the chat store (module scope, no React). */
export function getAutoPause(): boolean {
  return autoPause
}

export function setAutoPause(value: boolean) {
  autoPause = value
  localStorage.setItem(AUTOPAUSE_KEY, value ? 'on' : 'off')
  notify()
}

// v2: re-defaults every existing browser back to verbose (log shown) — the
// old key carried stale 'off's from before the toggle had a visible state.
const SHOW_ACTIVITY_KEY = 'agents-api-workbench-show-activity-v2'

let showActivity = localStorage.getItem(SHOW_ACTIVITY_KEY) !== 'off'

/** Render the agent activity log lines (session.turn.* narration) between
 * chat bubbles. Default on; hiding leaves only prompts and answers. */
export function useShowActivity(): boolean {
  return useSyncExternalStore(subscribe, () => showActivity)
}

export function setShowActivity(value: boolean) {
  showActivity = value
  localStorage.setItem(SHOW_ACTIVITY_KEY, value ? 'on' : 'off')
  notify()
}
