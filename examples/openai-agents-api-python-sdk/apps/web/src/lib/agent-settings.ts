// Draft agent config for the NEXT session (localStorage-backed, live-updating,
// same pattern as settings.ts). The Agents API binds model/reasoning/text/
// service_tier when a session is created, so this draft only matters for chats
// whose first turn hasn't run yet — afterwards the snapshot's values (and its
// `agent_locked` flag) win.
import { useSyncExternalStore } from 'react'
import type { components } from '@/api/schema'

export type ReasoningEffort = components['schemas']['ReasoningEffort']
export type Verbosity = components['schemas']['Verbosity']
export type ServiceTier = components['schemas']['ServiceTier']
export type Capabilities = components['schemas']['Capabilities']

// Runtime mirrors of the generated unions — `satisfies` breaks the build if
// the OpenAPI enums (which mirror the OpenAI SDK literals) drift.
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[]
export const VERBOSITIES = [
  'low',
  'medium',
  'high',
] as const satisfies readonly Verbosity[]
export const SERVICE_TIERS = [
  'auto',
  'default',
  'flex',
  'priority',
] as const satisfies readonly ServiceTier[]

export type AgentSettings = {
  model: string
  /** null = let the API pick its default. */
  reasoningEffort: ReasoningEffort | null
  textVerbosity: Verbosity | null
  serviceTier: ServiceTier | null
  capabilities: Capabilities
}

// Mirrors the backend's AGENTS_API_MODEL default.
const DEFAULT_MODEL = 'gpt-5.6-sol'
// Ids the Agents API stopped accepting (404 model_not_found). A draft saved
// with one of these falls back to the default instead of failing every chat.
const RETIRED_MODEL_IDS = new Set(['gpt-5.6'])

// Versioned so a default change can ignore stale saved data instead of
// letting it win. v2 dropped the v1 drafts when delegation and shared memory
// became always-on (a saved model pick is the only thing lost, and one click
// restores it).
const STORAGE_KEY = 'agents-api-workbench-agent-settings:v2'
const MCP_DEFAULTS_VERSION = 1

function load(): AgentSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      model:
        typeof raw.model === 'string' &&
        raw.model &&
        !RETIRED_MODEL_IDS.has(raw.model)
          ? raw.model
          : DEFAULT_MODEL,
      reasoningEffort: REASONING_EFFORTS.includes(raw.reasoningEffort)
        ? raw.reasoningEffort
        : null,
      textVerbosity: VERBOSITIES.includes(raw.textVerbosity)
        ? raw.textVerbosity
        : null,
      serviceTier: SERVICE_TIERS.includes(raw.serviceTier)
        ? raw.serviceTier
        : null,
      capabilities: {
        // `servers` stays absent until the picker is touched: the catalog and
        // its default selection live on the dispatcher (GET /api/mcp/servers,
        // like the shared chat archive), so the draft never hardcodes them.
        // Absent is also what the API reads as "attach the default".
        mcp: {
          ...(raw.mcpDefaultsVersion === MCP_DEFAULTS_VERSION && Array.isArray(raw.capabilities?.mcp?.servers)
            ? { servers: [...new Set((raw.capabilities.mcp.servers as unknown[])
              .filter((value): value is string => typeof value === 'string'))] }
            : {}),
          tool_search: raw.mcpDefaultsVersion === MCP_DEFAULTS_VERSION
            ? raw.capabilities?.mcp?.tool_search !== false : true,
        },
        // Always on: the transcript renders the summary as a collapsed block,
        // so there is nothing to opt out of and no switch in the composer.
        reasoning_summary: { enabled: true },
        // Always on with three subagents, like reasoning_summary: the
        // composer has no delegation switch, so a stored value never wins.
        delegation: { enabled: true, max_agents: 3 },
        // Always on, like reasoning_summary: the sidebar's Shared memory
        // popup is where the workbench shows and prunes what the agent saved,
        // so there is no switch in the composer to opt out of.
        memory: { enabled: true },
      },
    }
  } catch {
    return {
      model: DEFAULT_MODEL,
      reasoningEffort: null,
      textVerbosity: null,
      serviceTier: null,
      capabilities: { memory: { enabled: true }, reasoning_summary: { enabled: true },
        delegation: { enabled: true, max_agents: 3 },
        mcp: { tool_search: true } },
    }
  }
}

let settings = load()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAgentSettings(): AgentSettings {
  return useSyncExternalStore(subscribe, () => settings)
}

// MCP option values are API keys: they live in this tab's memory until the
// first turn sends them, never in localStorage. `load()` never reads them
// back either, so a reload starts with the servers picked and the keys blank.
function persistable(value: AgentSettings): AgentSettings & { mcpDefaultsVersion: number } {
  const { options: _options, ...mcp } = value.capabilities.mcp ?? { tool_search: true }
  return { ...value, mcpDefaultsVersion: MCP_DEFAULTS_VERSION, capabilities: { ...value.capabilities, mcp } }
}

export function setAgentSettings(patch: Partial<AgentSettings>) {
  settings = { ...settings, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(settings)))
  for (const listener of listeners) {
    listener()
  }
}

/** ChatRequest fields for the draft config (nulls omitted → API defaults). */
export function agentRequestFields(): {
  model: string
  reasoning_effort?: ReasoningEffort
  text_verbosity?: Verbosity
  service_tier?: ServiceTier
  capabilities: Capabilities
} {
  return {
    model: settings.model,
    capabilities: settings.capabilities,
    ...(settings.reasoningEffort
      ? { reasoning_effort: settings.reasoningEffort }
      : {}),
    ...(settings.textVerbosity
      ? { text_verbosity: settings.textVerbosity }
      : {}),
    ...(settings.serviceTier ? { service_tier: settings.serviceTier } : {}),
  }
}
