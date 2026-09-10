import { code } from '@streamdown/code'
import { createContext, useContext, type ReactNode } from 'react'
import { Block, type BlockProps, type IconMap, Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import {
  AddIcon,
  CheckmarkIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  NewTabIcon,
  RemoveIcon,
  SpinnerIcon,
  UndoIcon,
} from '@/ui/primitives/icons'

// Streamdown control chrome (copy/download/fullscreen/zoom buttons) rendered
// with the E2B icon set instead of its bundled lucide defaults.
const streamdownIcons: Partial<IconMap> = {
  CheckIcon: CheckmarkIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon: SpinnerIcon,
  Maximize2Icon: NewTabIcon,
  RotateCcwIcon: UndoIcon,
  XIcon: CloseIcon,
  ZoomInIcon: AddIcon,
  ZoomOutIcon: RemoveIcon,
}

const AfterBlocks = createContext<ReadonlyMap<number, ReactNode> | undefined>(undefined)

function BlockWithInsertions(props: BlockProps) {
  const afterBlocks = useContext(AfterBlocks)
  return <><Block {...props} />{afterBlocks?.get(props.index)}</>
}

/** The app's one Streamdown setup — assistant bubbles and the workspace file
 * viewer share the same brand CSS (.assistant-md), E2B chrome icons, shiki
 * themes, and code plugin so markdown looks identical everywhere. */
export function Markdown({
  children,
  className,
  afterBlocks,
}: {
  children: string
  className?: string
  afterBlocks?: ReadonlyMap<number, ReactNode>
}) {
  return (
    <AfterBlocks.Provider value={afterBlocks}>
      <Streamdown
        BlockComponent={BlockWithInsertions}
        className={cn('assistant-md min-w-0 space-y-3 break-words', className)}
        icons={streamdownIcons}
        plugins={{ code }}
        shikiTheme={['github-light', 'github-dark']}
      >
        {children}
      </Streamdown>
    </AfterBlocks.Provider>
  )
}
