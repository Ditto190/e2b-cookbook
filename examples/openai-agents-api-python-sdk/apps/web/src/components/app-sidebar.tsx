import { MemoryPanel } from '@/components/memory-panel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EditIcon, MoreActionsIcon } from '@/ui/primitives/icons'
import { useState } from 'react'
import { E2BLogoSmall } from '@/components/brand'
import { OpenAILogo } from '@/components/openai-logo'
import { Loader } from '@/components/ui/loader'
import type { ArchivedSession } from '@/lib/sessions'
import { cn } from '@/lib/utils'

// Partner lockup — lives in the sidebar footer under the app title; each
// logo links to its company page. Per OpenAI brand spec: wordmark, vertical
// rule (taller than the logos, equal gaps), partner's logo.
function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-fg-tertiary', className)}>
      <a
        aria-label="OpenAI"
        className="shrink-0 transition-colors hover:text-fg"
        href="https://openai.com"
        rel="noreferrer"
        target="_blank"
      >
        <OpenAILogo className="h-5 w-auto" />
      </a>
      <span aria-hidden className="h-6 w-px shrink-0 bg-current opacity-40" />
      <a
        aria-label="E2B"
        className="shrink-0 transition-colors hover:text-fg"
        href="https://e2b.dev"
        rel="noreferrer"
        target="_blank"
      >
        {/* 17.5px keeps the original 0.875 E2B:OpenAI height ratio. */}
        <E2BLogoSmall className="h-[1.09375rem] w-auto" />
      </a>
    </div>
  )
}

function sessionMeta(session: ArchivedSession, streaming: boolean): string {
  const time = new Date(session.updatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const turns = `${session.turns.length} turn${session.turns.length === 1 ? '' : 's'}`
  const state = session.expired
    ? 'expired'
    : streaming
      ? 'streaming'
      : 'resumable'
  return `${state} · ${time} · ${turns}`
}

// Fallback row label while no sandbox id has been reported yet — once one
// exists the row renders SandboxIdChip instead.
function sessionLabel(session: ArchivedSession): string {
  if (session.sessionId) {
    return session.sessionId
  }
  return session.title
}

// Sandbox-id row label — plain text; copying lives in the row's ⋮ menu.
// pr-12 clears the two absolute hover buttons (fork + ⋮).
function SandboxIdChip({ id }: { id: string }) {
  return (
    <span className="w-full truncate pr-12 font-mono text-[11.5px] text-fg-secondary">
      {id}
    </span>
  )
}

// Git-branch fork glyph, hand-drawn in the Figma icon set's dialect (16px
// grid, 1.33 stroke, square caps) — the synced set has no fork icon and the
// icons dir is generated, so this one lives here instead.
function ForkIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="4" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.33333" />
      <circle cx="12" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.33333" />
      <circle cx="4" cy="12.5" r="1.75" stroke="currentColor" strokeWidth="1.33333" />
      <path
        d="M4 5.25V10.75M12 5.25V6.5C12 8 10.75 8.75 9.5 8.75H6.5C5.25 8.75 4 9.5 4 11"
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth="1.33333"
      />
    </svg>
  )
}

type ChatNode = { session: ArchivedSession; children: ChatNode[] }

// Group the flat archive into a fork tree via parentChatId. The input is
// display-ordered (recency), so roots and each child list inherit that order
// for free. An unknown parent (deleted, or archived elsewhere) promotes the
// fork to a root — no orphan handling needed anywhere else.
function buildChatTree(sessions: ArchivedSession[]): ChatNode[] {
  const nodes = new Map(
    sessions.map((session) => [
      session.id,
      { session, children: [] as ChatNode[] },
    ])
  )
  const roots: ChatNode[] = []
  for (const session of sessions) {
    const node = nodes.get(session.id)!
    const parent = session.parentChatId
      ? nodes.get(session.parentChatId)
      : undefined
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// Per-row handlers threaded through the recursive tree unchanged.
type RowHandlers = {
  viewId: string
  streaming: Set<string>
  unseen: Set<string>
  /** Row whose fork/promote is in flight — its fork button shows a loader. */
  forkingId: string | null
  onSelect: (id: string) => void
  onFork: (id: string) => void
  /** Clone a fork into a standalone root chat (new sandbox, no lineage). */
  onPromote: (id: string) => void
  onDelete: (id: string) => void
}

// One chat row — label/meta lines, right-side status slot, fork button + ⋮
// actions menu. No expand/collapse: forks are always visible, the indent
// rail alone carries the hierarchy, so every label shares one left edge.
function ChatRow({
  session,
  viewId,
  streaming,
  unseen,
  forkingId,
  onSelect,
  onFork,
  onPromote,
  onDelete,
}: {
  session: ArchivedSession
} & RowHandlers) {
  const isStreaming = streaming.has(session.id)
  const isUnseen = unseen.has(session.id)
  const isForking = forkingId === session.id
  return (
    <div className="group relative">
      {/* div[role=button], not <button>: the overlaid fork/⋮ triggers are
          real buttons and buttons can't nest (exception carried in
          doctor.config.json). */}
      <div
        className={cn(
          'flex w-full cursor-pointer items-center px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-bg-highlight',
          // Selected row rests at the strong fill so the current chat reads
          // at a glance; hover still steps up so it never looks hover-dead.
          session.id === viewId && 'bg-fill-highlight/60 hover:bg-fill-highlight/80'
        )}
        onClick={() => onSelect(session.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(session.id)
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* pr-12 clears the absolute action slot (fork button at right-7
              plus ⋮ at right-1.5) with breathing room on both lines. */}
          {session.sandboxId ? (
            <SandboxIdChip id={session.sandboxId} />
          ) : (
            <span className="w-full truncate pr-12 text-[12.5px] text-fg-secondary">
              {sessionLabel(session)}
            </span>
          )}
          <span className="w-full truncate pr-12 text-[10.5px] text-fg-tertiary">
            {sessionMeta(session, isStreaming)}
          </span>
        </div>
      </div>
      {/* Right-side status slot: spinner while streaming; brand dot
          once a turn finished unwatched; hover swaps in the actions
          menu (⋮ → fork/delete). */}
      {/* top-1/2 -translate-y-1/2: pin every status glyph to the exact
          vertical middle of the two-line row, not the first line. */}
      {isStreaming ? (
        <span role="status" aria-label="Agent working" className="-translate-y-1/2 absolute top-1/2 right-2 p-1">
          <Loader size="sm" className="text-fg-tertiary" />
        </span>
      ) : (
        <>
          {isUnseen && (
            <span role="status" aria-label="New response" className="-translate-y-1/2 absolute top-1/2 right-2 p-1 group-hover:opacity-0">
              <span className="block size-2 bg-accent-main-highlight" />
            </span>
          )}
          {/* Dedicated fork button, left of the ⋮ — same hover-only rhythm.
              While its fork/promote runs it swaps to the app loader and stays
              visible (no hover needed) until the new sandbox is booted. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`Fork ${session.title}`}
                className={cn(
                  '-translate-y-1/2 absolute top-1/2 right-7 p-1 text-fg-tertiary opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100',
                  isForking && 'opacity-100'
                )}
                disabled={isForking}
                onClick={(event) => {
                  event.stopPropagation()
                  onFork(session.id)
                }}
                onKeyDown={(event) => event.stopPropagation()}
                type="button"
              >
                {isForking ? (
                  <Loader size="sm" className="text-fg-tertiary" />
                ) : (
                  <ForkIcon className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isForking ? 'Forking…' : 'Fork chat'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  {/* Hover-only, but stays visible while the menu is open
                      (data-[state=open] wins over the base opacity-0). */}
                  <button
                    aria-label={`Chat actions for ${session.title}`}
                    className="-translate-y-1/2 absolute top-1/2 right-1.5 p-1 text-fg-tertiary opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:bg-bg-highlight data-[state=open]:text-fg data-[state=open]:opacity-100"
                    type="button"
                  >
                    {/* MoreActionsIcon is the Figma-synced horizontal ⋯ —
                        rotate-90 turns it into the vertical ⋮. */}
                    <MoreActionsIcon className="size-3.5 rotate-90" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Chat actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="start"
              className="rounded-none border-stroke bg-bg-1 text-fg-secondary shadow-[var(--shadow-float)]"
            >
              {session.sandboxId && (
                <DropdownMenuItem
                  className="cursor-pointer rounded-none text-table focus:bg-bg-highlight focus:text-fg"
                  onSelect={() =>
                    navigator.clipboard.writeText(session.sandboxId!)
                  }
                >
                  Copy sandbox id
                </DropdownMenuItem>
              )}
              {/* Forks only: clone into a standalone root chat (fresh
                  sandbox from a new snapshot, no lineage) — the original
                  stays nested under its parent. */}
              {session.parentChatId && (
                <DropdownMenuItem
                  className="cursor-pointer rounded-none text-table focus:bg-bg-highlight focus:text-fg"
                  onSelect={() => onPromote(session.id)}
                >
                  Promote to new sandbox
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="cursor-pointer rounded-none text-table focus:bg-bg-highlight focus:text-fg"
                onSelect={() => onFork(session.id)}
              >
                Fork chat
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer rounded-none text-table text-accent-error-highlight focus:bg-bg-highlight focus:text-accent-error-highlight"
                onSelect={() => onDelete(session.id)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}

// One tree node: the row plus its forks nested inside an indented wrapper.
// The accent left rail marks the fork lineage (rails stack per level,
// VS Code-guide style) AND is the expand/collapse toggle — no chevron, so
// every label keeps one left edge. Collapsed, the subtree shrinks to a
// "N forks hidden" stub that re-expands on click (and keeps a rail stub
// alive so the toggle never disappears).
function ChatTreeItem({
  node,
  ...handlers
}: { node: ChatNode } & RowHandlers) {
  const [open, setOpen] = useState(true) // forks visible by default
  const count = node.children.length
  return (
    <div>
      <ChatRow session={node.session} {...handlers} />
      {count > 0 && (
        <div className="relative ml-4 space-y-0.5">
          {/* The rail: a full-height 10px hit strip around a visible 2px
              line. It overlays only the child rows' left padding, so row
              clicks stay unaffected. */}
          <button
            aria-expanded={open}
            aria-label={open ? 'Collapse forks' : 'Expand forks'}
            className="-left-1 absolute inset-y-0 z-10 w-2.5 cursor-pointer hover:bg-bg-highlight"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span className="absolute inset-y-0 left-1 w-0.5 bg-accent-main-highlight" />
          </button>
          {open ? (
            node.children.map((child) => (
              <ChatTreeItem key={child.session.id} node={child} {...handlers} />
            ))
          ) : (
            <button
              className="w-full cursor-pointer px-2.5 py-1 text-left text-[10.5px] text-fg-tertiary transition-colors hover:bg-bg-highlight hover:text-fg"
              onClick={() => setOpen(true)}
              type="button"
            >
              {count} fork{count === 1 ? '' : 's'} hidden
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Left rail listing chats. Multi-session: every non-expired chat accepts
// messages, chats with a turn streaming keep running off-screen (the store
// holds their streams), so nothing here ever locks.
export function AppSidebar({
  sessions,
  viewId,
  activeIds,
  unseenIds,
  forkingId,
  onNew,
  onSelect,
  onFork,
  onPromote,
  onDelete,
}: {
  sessions: ArchivedSession[]
  viewId: string
  /** Comma-joined ids of chats with a turn streaming right now. */
  activeIds: string
  /** Comma-joined ids of chats whose turn finished while unwatched. */
  unseenIds: string
  /** Row whose fork/promote is in flight — its fork button shows a loader. */
  forkingId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onFork: (id: string) => void
  /** Clone a fork into a standalone root chat (new sandbox, no lineage). */
  onPromote: (id: string) => void
  onDelete: (id: string) => void
}) {
  const streaming = new Set(activeIds.split(',').filter(Boolean))
  const unseen = new Set(unseenIds.split(',').filter(Boolean))
  const handlers: RowHandlers = {
    viewId,
    streaming,
    unseen,
    forkingId,
    onSelect,
    onFork,
    onPromote,
    onDelete,
  }
  return (
    // Width comes from the SidePanel wrapper — the aside just fills it.
    // No vertical padding — the New chat button tops out at the chat pane's
    // top border, and the brand lockup bottoms out at its bottom border.
    // px-1 is the ONE horizontal inset for the whole rail — every child block
    // sits flush against it (no nested px/mx), so insets never stack up.
    <aside className="flex h-full w-full flex-col px-1">
      {/* Header block: the New chat button with the Shared memory row right
          under it, then a 24px gap before the Recents header. */}
      <div className="flex flex-col gap-1 pb-6">
        {/* h-12 lines the button up with the h-12 pane headers next door. */}
        <Button className="h-12 w-full" onClick={onNew} variant="secondary">
          <EditIcon />
          <span>New chat</span>
        </Button>
        <MemoryPanel />
      </div>
      <div className="flex items-center px-2.5 pb-1">
        <span className="text-[11px] text-fg-tertiary">Recents</span>
      </div>
      {/* Store array order IS the display order: a chat moves to the top when
          a turn message is sent (bumpSession), never mid-stream. Forks nest
          under their parent (buildChatTree) instead of listing flat. */}
      {/* TooltipProvider: one radix provider for every row's action
          tooltips; 400ms delay so hover-scanning the list doesn't flash
          tooltips on each row passed through. */}
      {/* disableHoverableContent: the tooltips sit right under the two
          adjacent action buttons — without it the open tooltip catches the
          pointer mid-move and the neighbor's tooltip never shows. */}
      <TooltipProvider delayDuration={400} disableHoverableContent>
        {/* The list fades out into the rail's background at its bottom edge:
            a long list visibly continues under the footer instead of being
            cut by a hard line. pb-8 lets the last row scroll clear of the
            fade so it stays readable at the end of the scroll. */}
        <div className="relative min-h-0 flex-1">
          <div className="h-full space-y-0.5 overflow-y-auto pb-8">
            {buildChatTree(sessions).map((node) => (
              <ChatTreeItem key={node.session.id} node={node} {...handlers} />
            ))}
            {sessions.length === 0 && (
              <p className="px-2.5 py-1.5 text-fg-tertiary text-label">
                No chats yet — send a message.
              </p>
            )}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-b from-transparent to-bg-1"
          />
        </div>
      </TooltipProvider>
      {/* Footer: app title over the partner lockup (theme toggle lives in
          the chat pane header's right cluster). Alignment contract: the
          lockup's bottom sits level with the send button's bottom edge next
          door, and the E2B "B" ends exactly where the title's "SDK" ends —
          w-fit makes the title text define the block width, justify-between
          stretches the lockup to both its edges. px-2.5 matches the chat
          rows. */}
      <div className="flex w-fit min-w-0 max-w-full shrink-0 flex-col gap-2 px-2.5 pt-8 pb-[1.125rem]">
        <span className="truncate font-normal text-[15px] text-fg">
          Agents API Python SDK
        </span>
        <BrandLockup className="w-full justify-between" />
      </div>
    </aside>
  )
}
