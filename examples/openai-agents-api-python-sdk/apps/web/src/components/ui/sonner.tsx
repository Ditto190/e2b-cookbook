import { useSyncExternalStore } from 'react'
import { Toaster as Sonner } from 'sonner'

// Follow the app's theme contract: the index.html bootstrap script and
// ThemeToggle both drive the `dark` class on <html>, so watch that class
// instead of pulling in next-themes (this is a Vite app). The class IS an
// external store — useSyncExternalStore, not useState+MutationObserver
// effect (same reasoning as useIsMobile).
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

function useDocumentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () =>
    document.documentElement.classList.contains('dark')
  )
    ? 'dark'
    : 'light'
}

// App-wide toaster, restyled to the design system: square corners, panel
// surface, IBM Plex via the inherited font stack. richColors keeps sonner's
// green/red state tinting for success/error.
export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  const theme = useDocumentTheme()
  return (
    <Sonner
      className="toaster group"
      offset={{ top: 56 }}
      position="top-center"
      richColors
      theme={theme}
      toastOptions={{
        classNames: {
          // Shape/typography for every state; surface colors only for the
          // neutral states — success/error keep richColors' green/red.
          // Shadcn-style entrance (dialog/popover combo): fade + slight
          // zoom + drop from the top. Keyframes only run on mount, so they
          // layer over sonner's own stacking transitions without fighting.
          toast:
            'group toast !rounded-none !shadow-[var(--shadow-float)] !font-sans animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-300',
          default: '!border-stroke !bg-bg-1 !text-fg-secondary',
          loading: '!border-stroke !bg-bg-1 !text-fg-secondary',
          actionButton: '!rounded-none',
          cancelButton: '!rounded-none',
        },
      }}
      {...props}
    />
  )
}
