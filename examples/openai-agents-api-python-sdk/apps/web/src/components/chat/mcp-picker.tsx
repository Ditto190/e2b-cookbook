import { Popover } from '@base-ui/react/popover'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchMcpCredentials, fetchMcpServers, saveMcpCredentials, type McpServerInfo } from '@/api/client'
import { KeyField } from '@/components/chat/key-setup-card'
import { InfoHint } from '@/components/info-hint'
import { Button, buttonVariants } from '@/components/ui/button'
import type { Capabilities } from '@/lib/agent-settings'
import { cn } from '@/lib/utils'
import { CheckmarkIcon, KeyIcon, SearchIcon } from '@/ui/primitives/icons'

export type McpSelection = NonNullable<Capabilities['mcp']>
const ORIGIN_LABELS = { service: 'hosted', environment: 'in sandbox', gateway: 'e2b catalog' } as const
const PINNED_SERVERS = ['hackernews', 'context7', 'deepwiki']
const ORIGIN_ORDER = ['service', 'environment', 'gateway'] as const
const GROUP_LABELS = { service: 'Hosted', environment: 'In sandbox', gateway: 'E2B catalog' } as const

export function McpPicker({ mcp, locked, busy = false, chatId, onChange }: {
  mcp: McpSelection
  locked: boolean
  busy?: boolean
  chatId?: string
  onChange: (patch: Partial<McpSelection>) => void | boolean | Promise<void | boolean>
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const [draft, setDraft] = useState<McpSelection>(mcp)
  const [editing, setEditing] = useState<McpServerInfo | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalog = useQuery({ queryKey: ['mcp-servers'], queryFn: fetchMcpServers,
    staleTime: Number.POSITIVE_INFINITY, retry: false })
  const credentials = useQuery({ queryKey: ['mcp-credentials'], queryFn: fetchMcpCredentials, enabled: open })
  const servers = catalog.data?.servers ?? []
  const picked = draft.servers ?? catalog.data?.default ?? []
  const savedOptions = credentials.data?.options ?? {}
  const configured = (server: McpServerInfo, key: string) => Boolean(
    savedOptions[server.label]?.[key] || mcp.options?.[server.label]?.[key])
  const ready = (server: McpServerInfo) => server.options.every((option) => !option.required || configured(server, option.key))
  // A pick without its required credentials is not configured, so it is not
  // selected: never saved, never activated. A restart empties the backend's
  // credential store while localStorage keeps the pick; this is where the two
  // reconcile. Save writes exactly `selected`.
  const isSelected = (server: McpServerInfo) => picked.includes(server.label) && ready(server)
  const selected = servers.filter(isSelected).map((server) => server.label)
  const canSaveCredentials = editing && editing.options.every((option) =>
    !option.required || fields[option.key]?.trim() || configured(editing, option.key))
  const visible = servers.filter((server) =>
    (!freeOnly || !server.needs_config || picked.includes(server.label)) &&
    `${server.name} ${server.label} ${server.description}`.toLowerCase().includes(query.toLowerCase()))

  const pinned = PINNED_SERVERS.flatMap((label) => visible.filter((server) =>
    server.label === label && server.connection_origin === 'gateway'))
  const groups = [
    { id: 'pinned', label: 'Pinned · E2B catalog', rows: pinned },
    ...ORIGIN_ORDER.map((origin) => ({
      id: origin, label: GROUP_LABELS[origin],
      rows: visible.filter((server) => server.connection_origin === origin && !pinned.includes(server)),
    })),
  ].filter((group) => group.rows.length > 0)

  function configure(server: McpServerInfo) {
    setEditing(server)
    setFields({})
    setError(null)
  }

  function toggle(server: McpServerInfo) {
    if (isSelected(server)) {
      setDraft({ ...draft, servers: picked.filter((label) => label !== server.label) })
    } else if (!ready(server)) {
      configure(server)
    } else {
      setDraft({ ...draft, servers: [...new Set([...picked, server.label])] })
    }
  }

  async function saveCredentials() {
    if (!editing || !canSaveCredentials || saving) return
    setSaving(true)
    setError(null)
    try {
      const data = await saveMcpCredentials(editing.label, fields, chatId)
      queryClient.setQueryData(['mcp-credentials'], data)
      setDraft({ ...draft, servers: [...new Set([...picked, editing.label])] })
      setFields({})
      setEditing(null)
      toast.success('MCP credentials saved')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save credentials.')
    } finally {
      setSaving(false)
    }
  }

  async function apply() {
    setSaving(true)
    setError(null)
    try {
      // Credentials were saved separately; selection requests carry no secrets.
      const queued = await onChange({ servers: selected, tool_search: draft.tool_search ?? true, options: {} })
      setOpen(false)
      toast.success(queued ? 'MCP changes saved for the next turn' : locked ? 'MCPs updated for this chat' : 'MCP selection saved')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save MCPs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      if (saving) return
      if (next) {
        void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
        setDraft(mcp)
        setQuery('')
        setEditing(null)
        setError(null)
      } else {
        setFields({})
      }
      setOpen(next)
    }}>
      <Popover.Trigger aria-label="MCP servers" className={cn(buttonVariants({ variant: 'secondary' }),
        'h-[clamp(1.75rem,8vw,2.25rem)] gap-1.5 enabled:hover:bg-fill data-[popup-open]:border-stroke-active data-[popup-open]:bg-fill')}>
        <span>MCPs</span><span className="text-fg-secondary">{(mcp.servers ?? catalog.data?.default ?? []).length}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" className="z-50" side="top" sideOffset={8}>
          <Popover.Popup className="flex h-[min(560px,80dvh,var(--available-height))] max-h-[var(--available-height)] w-[400px] max-w-[92vw] flex-col overflow-hidden border border-stroke bg-bg-1 text-fg shadow-[var(--shadow-float)] outline-none">
            {editing ? <form className="contents" onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void saveCredentials()
            }}>
              <div className="flex shrink-0 items-center gap-3 border-b border-stroke px-3 py-2">
                <Button disabled={saving} onClick={() => { setEditing(null); setFields({}); setError(null) }} className="h-8 shrink-0 px-3" type="button" variant="secondary">Back</Button>
                <Popover.Title className="min-w-0 truncate text-table-highlight">{editing.name}</Popover.Title>
              </div>
              <div aria-label={`${editing.name} configuration`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" role="region" tabIndex={0}>
                <p className="mb-4 text-label text-fg-secondary">{editing.description}</p>
                <div className="flex flex-col gap-4">
                  {editing.options.map((option) => <KeyField key={`${editing.label}:${option.key}`}
                    hint={option.description || undefined}
                    label={option.required ? `${option.key} *` : option.key}
                    onChange={(value) => setFields({ ...fields, [option.key]: value })}
                    placeholder={configured(editing, option.key) ? 'Saved — leave blank to keep' : option.required ? 'Required' : 'Optional'}
                    secret={option.secret} value={fields[option.key] ?? ''} />)}
                </div>
              </div>
              <div className="shrink-0 border-t border-stroke p-3">
                <p className="mb-3 text-label text-fg-tertiary">Saved credentials are shared within this running workbench and sent to the selected MCP. Save them again after an app restart.</p>
                {error && <p className="mb-2 text-label text-accent-error-highlight" role="alert">{error}</p>}
                <Button className="w-full" disabled={!canSaveCredentials || saving} type="submit">
                  {saving ? 'Saving…' : 'Save credentials'}
                </Button>
              </div>
            </form> : <>
              <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-3">
                <SearchIcon className="size-3.5 shrink-0 text-icon-tertiary" />
                <input aria-label="Search MCP servers" autoComplete="off" value={query}
                  onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${servers.length} servers…`}
                  className="h-10 min-w-0 flex-1 bg-transparent text-table outline-none placeholder:text-fg-tertiary" />
                <button aria-pressed={freeOnly} className={cn('shrink-0 border px-1.5 py-0.5 text-label', freeOnly ? 'border-stroke-active bg-fill' : 'border-stroke text-fg-secondary')}
                  onClick={() => setFreeOnly(!freeOnly)} title="Only servers that work without an API key" type="button">Free</button>
                <button className="shrink-0 border border-stroke px-1.5 py-0.5 text-label text-fg-secondary disabled:opacity-50" disabled={saving || !picked.length}
                  onClick={() => setDraft({ ...draft, servers: [] })} type="button">Deselect all</button>
              </div>
              <Popover.Title className="sr-only">MCP servers</Popover.Title>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" role="region" aria-label="Available MCP servers" tabIndex={0}>
                {catalog.isPending && <p className="p-3 text-label" role="status">Loading servers…</p>}
                {(catalog.isError || credentials.isError) && <p className="p-3 text-label text-accent-error-highlight" role="alert">Could not load MCP settings. Close and reopen to retry.</p>}
                {groups.map((group) => {
                  return <section key={group.id} aria-label={group.label} className={cn('not-first:mt-1 not-first:border-t not-first:border-stroke', group.id === 'pinned' && 'border-l-2 border-stroke-active bg-fill/30')}>
                    <h3 className="px-2 pt-2 pb-1 text-label text-fg-tertiary">{group.label}</h3>
                    {group.rows.map((server) => <div key={server.label} className={cn('px-2 py-1.5 hover:bg-fill', isSelected(server) && 'bg-fill/60')}>
                      <button aria-label={server.name} aria-pressed={isSelected(server)} className="block w-full text-left" disabled={saving} onClick={() => toggle(server)} type="button">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-table-highlight">{server.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-label text-fg-secondary">
                            {ORIGIN_LABELS[server.connection_origin]}{server.needs_config && <KeyIcon className="size-3" />}
                            {isSelected(server) && <CheckmarkIcon aria-label="Selected" className="size-3.5" />}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-label text-fg-secondary">{server.description}</span>
                      </button>
                      {server.options.length > 0 && (picked.includes(server.label) || ready(server)) &&
                        <div className="mt-1 flex items-center justify-between gap-2 text-label">
                          <span className="text-fg-tertiary">{ready(server) ? 'Credentials saved' : 'Not configured, so not selected'}</span>
                          <button className="text-fg underline underline-offset-2" disabled={saving} onClick={() => configure(server)} type="button">Configure {server.name}</button>
                        </div>}
                    </div>)}
                  </section>
                })}
                {!catalog.isPending && !visible.length && <p className="p-3 text-center text-label text-fg-tertiary">No server matches.</p>}
                {picked.filter((label) => !servers.some((server) => server.label === label)).map((label) =>
                  <button key={label} type="button" className="block w-full px-2 py-2 text-left text-label" onClick={() => setDraft({ ...draft, servers: picked.filter((value) => value !== label) })}>
                    {label} · Unavailable — remove
                  </button>)}
              </div>
              <div className="shrink-0 border-t border-stroke p-3">
                <div className="mb-3 flex items-center justify-between gap-2 text-label">
                  <span className="flex items-center gap-1.5">
                    Tool search
                    <InfoHint label="About tool search">
                      <p><b className="font-medium text-fg">On:</b> the model gets a tool_search tool and finds the selected servers' tools on demand. Tool schemas stay out of the prompt until needed, so many servers cost little context.</p>
                      <p className="mt-1.5"><b className="font-medium text-fg">Off:</b> every tool from the selected servers is listed in the prompt up front. Simplest with a few servers; each schema costs context on every turn.</p>
                    </InfoHint>
                  </span>
                  <button aria-checked={draft.tool_search ?? true} aria-label="Tool search" className="text-fg-secondary hover:text-fg" disabled={saving}
                    onClick={() => setDraft({ ...draft, tool_search: !(draft.tool_search ?? true) })} role="switch" type="button">
                    {(draft.tool_search ?? true) ? 'On' : 'Off'}
                  </button>
                </div>
                <p className="mb-3 text-label text-fg-tertiary">{busy ? 'Save now. Changes apply automatically before the next turn.' : locked ? 'Your chat and workspace are kept when you change MCPs.' : 'Choose servers for your chat. You can add more later.'}</p>
                {error && <p className="mb-2 text-label text-accent-error-highlight" role="alert">{error}</p>}
                <Button className="w-full" disabled={saving || catalog.isPending || credentials.isPending || catalog.isError || credentials.isError} onClick={() => void apply()} type="button">
                  {saving ? 'Applying MCPs…' : `Save MCPs (${selected.length})`}
                </Button>
              </div>
            </>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
