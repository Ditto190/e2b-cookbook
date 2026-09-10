import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The theme's typography utilities (theme.css `@utility text-*`) look like
// text-color classes to tailwind-merge, so e.g. cn('text-label',
// 'text-fg-tertiary') silently dropped the size class. Register them as
// font-size classes so they only conflict with other sizes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-headline',
        'text-headline-small',
        'text-label',
        'text-label-highlight',
        'text-label-numeric',
        'text-label-numeric-highlight',
        'text-body',
        'text-body-highlight',
        'text-body-numeric',
        'text-body-numeric-highlight',
        'text-table',
        'text-table-highlight',
        'text-table-numeric',
        'text-value-big',
        'text-value-small',
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
