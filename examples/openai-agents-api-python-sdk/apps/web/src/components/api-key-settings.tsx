import { Dialog } from '@base-ui/react/dialog'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { KeySetupCard } from '@/components/chat/key-setup-card'
import { Button } from '@/components/ui/button'
import { CloseIcon, SettingsIcon } from '@/ui/primitives/icons'

const CloseSettingsContext = createContext<() => void>(() => {})
const CanDismissSettingsContext = createContext(false)

export function ApiKeySettingsProvider({
  keysMissing,
  hasKeys,
  children,
}: {
  keysMissing: boolean
  hasKeys: boolean
  children: ReactNode
}) {
  const [requestedOpen, setRequestedOpen] = useState<boolean | null>(null)

  return (
    <CloseSettingsContext.Provider value={() => setRequestedOpen(false)}>
      <CanDismissSettingsContext.Provider value={hasKeys}>
        <Dialog.Root
          modal={false}
          disablePointerDismissal={!hasKeys}
          open={keysMissing && !hasKeys ? true : requestedOpen ?? keysMissing}
          onOpenChange={(open, eventDetails) => {
            if (!open && !hasKeys) {
              eventDetails.cancel()
              return
            }
            setRequestedOpen(open)
          }}
        >
          {children}
        </Dialog.Root>
      </CanDismissSettingsContext.Provider>
    </CloseSettingsContext.Provider>
  )
}

export function ApiKeySettings() {
  return (
    <Dialog.Trigger
      render={
        <Button
          className="text-fg-tertiary [&_svg]:text-fg-tertiary aria-expanded:bg-fill-highlight/40 aria-expanded:text-fg aria-expanded:[&_svg]:text-fg"
          size="icon-sm"
          variant="quaternary"
          title="API key settings"
        />
      }
    >
      <SettingsIcon aria-hidden />
      <span className="sr-only">API key settings</span>
    </Dialog.Trigger>
  )
}

export function ApiKeyPanel({ keysMissing }: { keysMissing: boolean }) {
  const close = useContext(CloseSettingsContext)
  const canDismiss = useContext(CanDismissSettingsContext)
  const container = useRef<HTMLDivElement>(null)

  return (
    <div ref={container} className="pointer-events-none absolute inset-x-2 bottom-full z-20 overflow-hidden">
      <Dialog.Portal container={container}>
        <Dialog.Popup
          initialFocus={false}
          className="pointer-events-auto relative mb-3 max-h-[calc(100dvh-16rem)] overflow-y-auto border border-stroke bg-bg-1 p-4 shadow-[var(--shadow-float-soft)] transition-transform duration-250 ease-out data-[starting-style]:translate-y-[calc(100%+0.75rem)] data-[ending-style]:translate-y-[calc(100%+0.75rem)] motion-reduce:transition-none"
        >
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-fg text-headline-small">
              {keysMissing ? 'API key needed' : 'API key settings'}
            </Dialog.Title>
            {canDismiss && (
              <Dialog.Close render={<Button size="icon-sm" variant="quaternary" aria-label="Close API key settings" />}>
                <CloseIcon aria-hidden />
              </Dialog.Close>
            )}
          </div>
          <KeySetupCard
            settings
            className="max-w-none border-0 p-0 pt-1"
            onSaved={() => {
              close()
              toast.success('API keys saved')
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </div>
  )
}
