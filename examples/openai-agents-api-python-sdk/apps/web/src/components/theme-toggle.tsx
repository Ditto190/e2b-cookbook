import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The ui.e2b.dev switch-light sun, verbatim: one filled path (disc + rays),
// colored by currentColor. Lives here, not in ui/primitives/icons — that dir
// is Figma-synced and this glyph comes from the website embed instead.
function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        clipRule="evenodd"
        d="M12 4C12.28 4 12.5 4.22 12.5 4.5V6C12.5 6.28 12.28 6.5 12 6.5C11.72 6.5 11.5 6.28 11.5 6V4.5C11.5 4.22 11.72 4 12 4ZM12 15.5C13.93 15.5 15.5 13.93 15.5 12C15.5 10.07 13.93 8.5 12 8.5C10.07 8.5 8.5 10.07 8.5 12C8.5 13.93 10.07 15.5 12 15.5ZM12.5 18C12.5 17.72 12.28 17.5 12 17.5C11.72 17.5 11.5 17.72 11.5 18V19.5C11.5 19.78 11.72 20 12 20C12.28 20 12.5 19.78 12.5 19.5V18ZM6.34 6.34C6.54 6.15 6.86 6.15 7.05 6.34L8.11 7.4C8.3 7.6 8.3 7.91 8.11 8.11C7.91 8.3 7.6 8.3 7.4 8.11L6.34 7.05C6.15 6.86 6.15 6.54 6.34 6.34ZM16.6 15.89C16.4 15.7 16.09 15.7 15.89 15.89C15.7 16.09 15.7 16.4 15.89 16.6L16.95 17.66C17.14 17.85 17.46 17.85 17.66 17.66C17.85 17.46 17.85 17.14 17.66 16.95L16.6 15.89ZM4 12C4 11.72 4.22 11.5 4.5 11.5H6C6.28 11.5 6.5 11.72 6.5 12C6.5 12.28 6.28 12.5 6 12.5H4.5C4.22 12.5 4 12.28 4 12ZM18 11.5C17.72 11.5 17.5 11.72 17.5 12C17.5 12.28 17.72 12.5 18 12.5H19.5C19.78 12.5 20 12.28 20 12C20 11.72 19.78 11.5 19.5 11.5H18ZM8.11 15.89C8.3 16.09 8.3 16.4 8.11 16.6L7.05 17.66C6.86 17.85 6.54 17.85 6.34 17.66C6.15 17.46 6.15 17.14 6.34 16.95L7.4 15.89C7.6 15.7 7.91 15.7 8.11 15.89ZM17.66 7.05C17.85 6.86 17.85 6.54 17.66 6.34C17.46 6.15 17.14 6.15 16.95 6.34L15.89 7.4C15.7 7.6 15.7 7.91 15.89 8.11C16.09 8.3 16.4 8.3 16.6 8.11L17.66 7.05Z"
        fill="currentColor"
        fillRule="evenodd"
        // Stroke on top of the fill fattens every ray/disc edge (24-grid) —
        // 0.5 lands between the hairline original and the too-chunky 1.
        // Bolder than the 16-grid neighbors ON PURPOSE; don't "align" it
        // down again.
        stroke="currentColor"
        strokeWidth="0.5"
      />
    </svg>
  )
}

// The index.html bootstrap script defaults to light unless localStorage says
// 'dark' — this hook is the runtime side of that same contract.
function useTheme() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  )
  const toggle = () => {
    const next = !dark
    const apply = () => {
      setDark(next)
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('theme', next ? 'dark' : 'light')
    }
    // View Transitions crossfade the whole page instead of hard-swapping
    // every color at once; browsers without it just switch instantly.
    if (document.startViewTransition) {
      document.startViewTransition(apply)
    } else {
      apply()
    }
  }
  return { dark, toggle }
}

// Header icon button in the chat pane's right cluster, next to the
// activity-log toggle. One sun for both states (the ui.e2b.dev pattern) —
// the pressed-chip fill carries the dark/light state; the title names the
// mode a click switches to.
export function ThemeToggle() {
  const { dark, toggle } = useTheme()
  const label = `Switch to ${dark ? 'light' : 'dark'} mode`
  return (
    <Button
      aria-label={label}
      aria-pressed={dark}
      // Same toggle visual as the activity button next door: dark mode
      // engaged = filled chip + full-strength glyph, light = plain tertiary.
      // size-5 overrides the icon-sm size-4 cap — the sun/moon live on a
      // 24-grid with baked-in padding, so they need the bigger box to look
      // the same optical size as the 16-grid icons beside them.
      className={cn(
        '[&_svg]:size-5',
        dark
          ? 'bg-fill-highlight/40 text-fg [&_svg]:text-fg'
          : 'text-fg-tertiary [&_svg]:text-fg-tertiary'
      )}
      onClick={toggle}
      size="icon-sm"
      title={label}
      type="button"
      variant="quaternary"
    >
      <SunIcon />
    </Button>
  )
}
