import { Popover } from '@base-ui/react/popover'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteMemory, fetchMemories } from '@/api/client'
import { InfoHint } from '@/components/info-hint'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { cn } from '@/lib/utils'
import { MemoryIcon, RemoveIcon } from '@/ui/primitives/icons'

// Saved-at, in the shape a reader scans: fresh entries stay relative
// ("12m ago"), anything older than a day falls back to a calendar date.
// The <time> element keeps the exact ISO stamp for machines and hover.
function savedAt(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function MemoryPanel() {
  const [open, setOpen] = useState(false)
  const client = useQueryClient()
  // enabled: open — the rail never polls for a panel nobody opened; the
  // 5s refetch keeps the popup live while another chat is saving memories.
  const memories = useQuery({
    queryKey: ['memories'],
    queryFn: fetchMemories,
    enabled: open,
    refetchInterval: open ? 5000 : false,
  })
  const deletion = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => client.invalidateQueries({ queryKey: ['memories'] }),
  })
  const error = deletion.error ?? memories.error
  const entries = memories.data?.entries

  return (
    // A row under the sidebar's New chat button (see AppSidebar); sized like
    // the chat rows below it, no inset of its own beyond the rail's px-1.
    <section className="flex min-h-9 items-center">
      <Popover.Root onOpenChange={setOpen} open={open}>
        {/* aria-label, not the visible text: the entry count sits in the row
            too and would otherwise slur into the accessible name. */}
        <Popover.Trigger
          aria-label="Shared memory"
          className={cn(
            buttonVariants({ variant: 'quaternary' }),
            'h-9 w-full justify-start gap-2 px-2.5 hover:bg-fill data-[popup-open]:bg-fill data-[popup-open]:text-fg'
          )}
        >
          <MemoryIcon className="size-4 shrink-0" />
          <span className="truncate">Shared memory</span>
          {entries && entries.length > 0 && (
            <span className="ml-auto text-fg-tertiary">{entries.length}</span>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="start" className="z-50" side="bottom" sideOffset={8}>
            {/* initialFocus: on a pointer open, leave focus alone. The default
                would focus the first focusable child, the "About shared
                memory" icon, whose tooltip opens on focus and would cover the
                list the click just asked for. Keyboard opens keep the default
                so focus still lands inside the popup. */}
            <Popover.Popup
              className="flex max-h-[70vh] w-80 max-w-[90vw] flex-col border border-stroke bg-bg-1 text-fg shadow-[var(--shadow-float)] outline-none"
              initialFocus={(openType) => openType === 'keyboard'}
            >
              <div className="shrink-0 border-stroke border-b px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-body-highlight">
                    Shared memory
                    <InfoHint label="About shared memory" side="right">
                      <p>The agent has two tools, save_memory and recall_memory. It saves only when you ask, e.g. "remember that I prefer pytest", and recalls before assuming a preference.</p>
                      <p className="mt-1.5">Entries are stored by the workbench backend in shared-memory.json and are visible to every chat here. Hover an entry to delete it. Subagents do not get these tools.</p>
                    </InfoHint>
                  </p>
                  {entries && entries.length > 0 && (
                    <Badge variant="defaultMuted">
                      {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-label text-fg-tertiary">
                  Shared with everyone on this workbench
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {memories.isPending && (
                  <p className="flex items-center gap-2 px-3 py-3 text-fg-secondary text-label" role="status">
                    <Loader className="text-xs" />
                    Loading memories...
                  </p>
                )}
                {error && (
                  <p className="px-3 py-3 text-accent-error-highlight text-label" role="alert">
                    {error.message}
                  </p>
                )}
                {entries?.length === 0 && (
                  <p className="px-3 py-3 text-fg-tertiary text-label">No shared memories yet.</p>
                )}
                <ul className="divide-y divide-stroke">
                  {entries?.map((entry) => (
                    // group: the delete affordance stays out of the way until
                    // the row is hovered or its button takes focus.
                    <li className="group px-3 py-2.5" key={entry.id}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="whitespace-pre-wrap break-words text-body">{entry.text}</p>
                        <Button
                          aria-label={`Delete memory: ${entry.text}`}
                          className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          disabled={deletion.isPending}
                          onClick={() => deletion.mutate(entry.id)}
                          size="icon-sm"
                          title="Delete memory"
                          type="button"
                          variant="quaternary"
                        >
                          <RemoveIcon />
                        </Button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-fg-tertiary text-label">
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="default">
                            {tag}
                          </Badge>
                        ))}
                        <time
                          dateTime={entry.created_at}
                          title={new Date(entry.created_at).toLocaleString()}
                        >
                          {savedAt(entry.created_at)}
                        </time>
                      </div>
                      <p className="mt-1 truncate font-mono text-fg-tertiary text-label">
                        {`Source chat: ${entry.source_chat_id}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </section>
  )
}
