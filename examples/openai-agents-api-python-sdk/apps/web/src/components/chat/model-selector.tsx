import { Combobox } from '@base-ui/react/combobox'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchModels } from '@/api/client'
import { buttonVariants } from '@/components/ui/button'
import {
  type AgentSettings,
  REASONING_EFFORTS,
  SERVICE_TIERS,
  VERBOSITIES,
} from '@/lib/agent-settings'
import {
  FALLBACK_MODEL_IDS,
  modelCapabilities,
  modelDisplayName,
} from '@/lib/models'
import { cn } from '@/lib/utils'
import {
  BuildIcon,
  CheckmarkIcon,
  CpuIcon,
  EyeOpenIcon,
  SearchIcon,
} from '@/ui/primitives/icons'

// The OpenAI mark, inlined (currentColor) so it follows the theme without an
// external logo fetch.
function OpenAILogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07ZM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49Zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9Zm16.6 3.86L13.1 8.36 15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.41-.67Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66ZM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68Zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5Z" />
    </svg>
  )
}

function CapabilityIcons({ id }: { id: string }) {
  const caps = modelCapabilities(id)
  return (
    <span className="flex shrink-0 items-center gap-2 text-fg-secondary">
      {caps.tools && <BuildIcon aria-label="Supports tool use" className="size-3.5" />}
      {caps.vision && <EyeOpenIcon aria-label="Supports vision" className="size-3.5" />}
      {caps.reasoning && (
        <CpuIcon aria-label="Supports reasoning" className="size-3.5" />
      )}
    </span>
  )
}

// The four knobs the Agents API binds at session creation, each a section in
// one command-palette style combobox. `value: null` = "let the API default"
// (rendered as the `auto` row; tier already ships an explicit `auto` literal).
type Section = 'model' | 'effort' | 'verbosity' | 'tier'
type Row = { section: Section; value: string | null; label: string; hint?: string }
type Group = { value: Section; label: string; items: Row[] }

const EFFORT_HINTS: Partial<Record<string, string>> = { none: 'no thinking', max: 'deepest' }
const TIER_HINTS: Partial<Record<string, string>> = {
  flex: 'slower · cheaper',
  priority: 'faster · premium',
}

function buildGroups(modelIds: string[]): Group[] {
  const withAuto = (section: Section, options: readonly string[], hints?: Partial<Record<string, string>>): Row[] => [
    { section, value: null, label: 'auto' },
    ...options.map((value) => ({ section, value, label: value, hint: hints?.[value] })),
  ]
  return [
    {
      value: 'model',
      label: 'Model',
      items: modelIds.map((id) => ({ section: 'model', value: id, label: modelDisplayName(id) })),
    },
    { value: 'effort', label: 'Effort', items: withAuto('effort', REASONING_EFFORTS, EFFORT_HINTS) },
    { value: 'verbosity', label: 'Verbosity', items: withAuto('verbosity', VERBOSITIES) },
    {
      value: 'tier',
      label: 'Tier',
      items: SERVICE_TIERS.map((value) => ({ section: 'tier', value, label: value, hint: TIER_HINTS[value] })),
    },
  ]
}

function currentValue(draft: AgentSettings, section: Section): string | null {
  switch (section) {
    case 'model': return draft.model
    case 'effort': return draft.reasoningEffort
    case 'verbosity': return draft.textVerbosity
    case 'tier': return draft.serviceTier
  }
}

function patchFor(row: Row): Partial<AgentSettings> {
  switch (row.section) {
    case 'model': return { model: row.value ?? undefined }
    case 'effort': return { reasoningEffort: row.value as AgentSettings['reasoningEffort'] }
    case 'verbosity': return { textVerbosity: row.value as AgentSettings['textVerbosity'] }
    case 'tier': return { serviceTier: row.value as AgentSettings['serviceTier'] }
  }
}

// Composer model pill → searchable, sectioned combobox (shadcn combobox
// pattern on the base-ui Combobox): Model / Effort / Verbosity / Tier live in
// one popup with a filter box on top. Picking a row applies it and keeps the
// popup open so the other knobs can be tuned in the same pass; Esc or an
// outside click closes.
export function ModelSelector({
  draft,
  onChange,
}: {
  draft: AgentSettings
  onChange: (patch: Partial<AgentSettings>) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { contains } = Combobox.useFilter({ sensitivity: 'base' })

  // Live ids from OpenAI via the backend; cached an hour to match its cache.
  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: fetchModels,
    staleTime: 3_600_000,
    retry: false,
  })
  const liveIds = modelsQuery.data?.models.map((model) => model.id)
  const ids = liveIds && liveIds.length > 0 ? liveIds : FALLBACK_MODEL_IDS
  // A saved draft's model may predate the live list — keep it selectable.
  const allIds = ids.includes(draft.model) ? ids : [draft.model, ...ids]
  const groups = buildGroups(allIds)

  // Non-default knobs, shown muted after the model name so the pill still
  // tells the whole story with the three old pills gone.
  const tuned = (['effort', 'verbosity', 'tier'] as const)
    .map((section) => currentValue(draft, section))
    .filter((value): value is string => value !== null && value !== 'auto')

  return (
    <Combobox.Root
      autoHighlight
      // Rows match on their section too, so "eff" surfaces every effort row
      // and "flex" finds the tier without knowing which section it lives in.
      filter={(row: Row, search) =>
        contains(`${row.section} ${row.label} ${row.hint ?? ''}`, search)
      }
      inputValue={query}
      itemToStringLabel={(row: Row) => row.label}
      items={groups}
      onInputValueChange={(value, details) => {
        // Applying a row must not echo its label into the search box.
        if (details.reason !== 'item-press') setQuery(value)
      }}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'item-press') return
        setOpen(next)
        if (!next) setQuery('')
      }}
      onValueChange={(row) => {
        if (row) onChange(patchFor(row))
      }}
      open={open}
      // Command-palette use: rows are actions, not a single bound value, so
      // the selection stays unbound and the ✓ comes from the draft instead.
      value={null}
    >
      <Combobox.Trigger
        aria-label="Model and agent settings"
        className={cn(
          buttonVariants({ variant: 'secondary' }),
          // Responsive pill height — full h-9 on desktop, ~28px on phones.
          'h-[clamp(1.75rem,8vw,2.25rem)] max-w-[320px]',
          // Visible hover/open states: the recipe's data-[state=open] rule is
          // radix syntax — base-ui sets data-popup-open, so it never fired,
          // and bg-bg-1 on the bg-bg-1 composer card was invisible anyway.
          'enabled:hover:bg-fill data-[popup-open]:border-stroke-active data-[popup-open]:bg-fill'
        )}
      >
        <OpenAILogo className="size-3.5" />
        {/* Key/value contrast: tag-style key, full-size medium value.
            items-baseline, not the button's items-center — two font sizes
            centered by box make the small caps float visibly high. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[9px] text-fg-tertiary uppercase tracking-wider">
            model
          </span>
          <span className="truncate font-medium">{modelDisplayName(draft.model)}</span>
          {tuned.length > 0 && (
            <span className="truncate text-label text-fg-tertiary" data-testid="tuned-summary">
              {tuned.map((value) => `· ${value}`).join(' ')}
            </span>
          )}
        </span>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" className="z-50" side="top" sideOffset={8}>
          <Combobox.Popup className="w-[300px] max-w-[90vw] overflow-hidden border border-stroke bg-bg-1 text-fg shadow-[var(--shadow-float)] outline-none">
            <div className="flex items-center gap-2 border-b border-stroke px-2.5">
              <SearchIcon className="size-3.5 shrink-0 text-icon-tertiary" />
              <Combobox.Input
                aria-label="Search settings"
                className="h-9 w-full bg-transparent text-table text-fg outline-none placeholder:text-fg-tertiary"
                placeholder="Search model, effort, verbosity, tier…"
              />
            </div>
            <Combobox.Empty className="px-2 py-3 text-center text-label text-fg-tertiary empty:hidden">
              No match.
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(360px,60vh)] overflow-y-auto p-1 empty:hidden">
              {(group: Group) => (
                <Combobox.Group
                  className="not-first:mt-1 not-first:border-t not-first:border-stroke not-first:pt-1"
                  items={group.items}
                  key={group.value}
                >
                  <Combobox.GroupLabel className="px-2 pt-1.5 pb-1 text-label text-fg-tertiary">
                    {group.label}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(row: Row) => {
                      const checked = currentValue(draft, row.section) === row.value
                      return (
                        <Combobox.Item
                          aria-checked={checked}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-table transition-colors',
                            // Keyboard/pointer highlight and the checked row
                            // share one fill so they merge when they coincide.
                            'data-[highlighted]:bg-fill',
                            checked && 'bg-fill/60'
                          )}
                          key={row.value ?? 'auto'}
                          value={row}
                        >
                          {row.section === 'model' && <OpenAILogo />}
                          <span className="flex-1 truncate">{row.label}</span>
                          {row.section === 'model' && row.value && <CapabilityIcons id={row.value} />}
                          {row.hint && (
                            <span className="text-label text-fg-tertiary">{row.hint}</span>
                          )}
                          {checked && (
                            <CheckmarkIcon aria-label="Selected" className="size-3.5 shrink-0 text-fg" />
                          )}
                        </Combobox.Item>
                      )
                    }}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
