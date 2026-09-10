import { useSyncExternalStore } from 'react'

// 68rem — between Tailwind lg (1024, chat too cramped with both panels) and
// xl (1280, drawers kicked in on widths that could fit the full layout).
// Below this, tablets count as mobile: side panels render as offcanvas
// drawers instead of in-flow columns.
const MOBILE_BREAKPOINT = 1088

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

// useSyncExternalStore, not useState+useEffect: the media query IS an
// external store, and the effect version set state synchronously on mount
// (a cascading second render the compiler can't optimize away).
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches)
}
