import { setMcpSelection, type SessionSnapshot } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { setSessionMeta } from '@/lib/sessions'
import {
  setAgentSettings,
  useAgentSettings,
  type Capabilities,
} from '@/lib/agent-settings'
import { McpPicker } from './mcp-picker'
import { ModelSelector } from './model-selector'

// Model settings bind at creation. MCP changes reconnect an idle chat while
// retaining its workspace and transcript.
export function AgentControls({
  snapshot,
  started,
  capabilities,
  chatId,
  active = false,
}: {
  snapshot: SessionSnapshot | undefined
  /** The viewed chat already has turns — config is bound, pills are moot. */
  started: boolean
  capabilities?: Capabilities
  chatId?: string
  active?: boolean
}) {
  const queryClient = useQueryClient()
  const draft = useAgentSettings()
  const locked = started || (snapshot?.agent_locked ?? false)
  const selected = locked
    ? (snapshot?.chat_id ? snapshot.capabilities : capabilities)
    : draft.capabilities
  type Mcp = NonNullable<Capabilities['mcp']>
  const draftMcp: Mcp = draft.capabilities.mcp ?? { tool_search: true }
  const mcp: Mcp = snapshot?.pending_mcp ?? (locked ? selected?.mcp : draftMcp) ?? { tool_search: true }
  const delegation = selected?.delegation?.enabled ?? false

  const setMcp = async (patch: Partial<Mcp>) => {
    if (locked) {
      const id = chatId ?? snapshot?.chat_id
      if (!id) throw new Error('Wait for the chat to connect before saving MCPs.')
      const updated = await setMcpSelection(id, { ...mcp, ...patch })
      queryClient.setQueryData(['status', id], updated)
      setSessionMeta(id, { capabilities: updated.capabilities, sessionId: updated.session_id })
      return Boolean(updated.pending_mcp)
    } else {
      setAgentSettings({ capabilities: { ...draft.capabilities, mcp: { ...draftMcp, ...patch } } })
    }
  }

  return (
    <>
      {!locked && <ModelSelector draft={draft} onChange={setAgentSettings} />}
      <McpPicker chatId={chatId ?? snapshot?.chat_id ?? undefined} busy={active || snapshot?.active} locked={locked} mcp={mcp} onChange={setMcp} />
      {snapshot?.pending_mcp && <span className="text-label text-fg-secondary" role="status">
        {active || snapshot.active ? 'MCP changes saved for the next turn' : 'Applying MCP changes…'}
      </span>}
      {snapshot?.mcp_update_error && <span className="text-label text-accent-error-highlight" role="alert">{snapshot.mcp_update_error}</span>}
      {/* Live subagent count, only while some are actually open: an idle
          chat (0) or a reconnect that lost track (unknown) shows nothing. */}
      {delegation && locked && snapshot?.subagents?.known && (snapshot.subagents.open ?? 0) > 0 && (
        <span className="border border-stroke px-2 py-1 text-label text-fg-secondary" role="status">
          {snapshot.subagents.open} open subagents
        </span>
      )}
    </>
  )
}
