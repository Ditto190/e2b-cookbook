import { FileIcon, FolderIcon } from '@/ui/primitives/icons'
import type { WorkspaceEntry } from '@/api/client'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export function FileList({
  entries,
  connected,
  loading,
  onSelect,
}: {
  entries: WorkspaceEntry[]
  connected: boolean
  loading: boolean
  onSelect: (path: string) => void
}) {
  if (!connected) {
    return (
      <p className="px-4 pb-4 pt-6 font-mono text-[11px] text-fg-tertiary">
        The workspace appears here once the first turn creates a sandbox.
      </p>
    )
  }
  if (loading) {
    return (
      <div className="space-y-2 px-4 pb-4 pt-6">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <p className="px-4 pb-4 pt-6 font-mono text-[11px] text-fg-tertiary">
        Workspace is empty.
      </p>
    )
  }
  return (
    // pt-5 + row py-1 lands the first row's content 24px below the pane
    // header — the same offset as the transcript's first item (py-6).
    <ul className="px-2 pb-2 pt-5">
      {entries.map((entry) => {
        const depth = entry.path.split('/').length - 1
        const name = entry.path.split('/').at(-1) ?? entry.path
        return (
          <li key={entry.path}>
            <button
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[11px] transition-colors',
                entry.kind === 'file'
                  ? 'text-fg hover:bg-bg-highlight'
                  : 'cursor-default text-fg-tertiary'
              )}
              disabled={entry.kind === 'directory'}
              onClick={() => onSelect(entry.path)}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              type="button"
            >
              {entry.kind === 'directory' ? (
                <FolderIcon className="size-3.5 shrink-0 text-icon-tertiary" />
              ) : (
                <FileIcon className="size-3.5 shrink-0 text-icon-secondary" />
              )}
              <span className="truncate">{name}</span>
              {entry.kind === 'file' && entry.size !== null ? (
                <span className="ml-auto shrink-0 text-[0.625rem] text-fg-tertiary tabular-nums">
                  {formatSize(entry.size)}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
