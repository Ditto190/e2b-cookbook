import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { InfoIcon } from '@/ui/primitives/icons'

/** An "i" icon next to a control that explains it on hover or focus. Carries
 * its own TooltipProvider: the app has no root provider, and the two places
 * that use this sit inside popovers of their own. */
export function InfoHint({ label, children, side = 'top' }: {
  /** Accessible name of the icon button, e.g. "About tool search". */
  label: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button aria-label={label} className="inline-flex shrink-0 text-icon-tertiary hover:text-fg focus-visible:text-fg" type="button">
            <InfoIcon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 whitespace-normal px-2.5 py-2 text-label leading-relaxed" side={side}>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
