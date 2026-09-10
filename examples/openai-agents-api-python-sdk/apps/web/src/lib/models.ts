// Model catalog decoration. GET /api/models (OpenAI's own list endpoint,
// proxied by the backend) supplies live ids; this module turns an id into a
// display name and capability flags — OpenAI's list endpoint carries neither.
// Shown when the backend list isn't loaded yet (or no key is set).
// Mirror the backend's MODELS_INCLUDE_PATTERN / MODELS_ALWAYS_OFFER (the
// gpt-5.5 / gpt-5.6 agent ids and their -sol/-luna variants): codex-family
// ids fail every self-hosted Agents API turn, so nothing else is offered.
export const FALLBACK_MODEL_IDS = ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5']

export type ModelCapabilities = {
  /** Accepts reasoning.effort (the whole agent family does). */
  reasoning: boolean
  /** Accepts image input. */
  vision: boolean
  /** Tool / function calling. */
  tools: boolean
}

// The backend filter only lets agent-capable families through, so these are
// uniform today — kept as a map so a divergent family is a one-line change.
export function modelCapabilities(id: string): ModelCapabilities {
  return {
    reasoning: true,
    tools: true,
    // The nano tier is text-only.
    vision: !id.includes('nano'),
  }
}

/** "gpt-5.5-codex-mini" → "GPT-5.5 Codex Mini". */
export function modelDisplayName(id: string): string {
  const [head = id, ...rest] = id.split('-')
  const words: string[] = []
  let version: string | undefined
  for (const part of rest) {
    if (/^\d/.test(part)) {
      version ??= part
    } else {
      words.push(part.charAt(0).toUpperCase() + part.slice(1))
    }
  }
  const family = head === 'gpt' ? 'GPT' : head.charAt(0).toUpperCase() + head.slice(1)
  return [version ? `${family}-${version}` : family, ...words].join(' ')
}
