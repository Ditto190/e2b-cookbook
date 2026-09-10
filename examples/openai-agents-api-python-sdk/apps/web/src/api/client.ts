// Thin typed client over the generated OpenAPI types (src/api/schema.ts,
// regenerate with `pnpm gen`). Every request/response shape here derives from
// the spec — no hand-typed payloads. The Vite dev server proxies /api to the
// Flask backend, so all paths are same-origin.
import type { components, operations } from './schema'
type ArchivedSession = components['schemas']['ArchivedChat']

// The last sandbox create/resume timing (backend DemoSession.last_wake):
// ms is E2B's own infra clock when `infra` is true (diffed from the sandbox
// logs API), otherwise the SDK round trip. seq dedupes the wake toast.
type SandboxWake = {
  kind: 'created' | 'resumed'
  ms: number
  infra: boolean
  /** True once the background logs fetch settled — ms is the definitive
   * number (infra clock, or the SDK fallback after a logs miss). */
  final: boolean
  seq: number
  at: number
}

// parent_chat_id is in the fixed fork contract (every snapshot carries it;
// null for root chats) but hasn't landed in openapi.yaml yet — this widening
// disappears once `pnpm gen` picks the field up from the spec. Same story
// for last_wake.
export type SessionSnapshot = components['schemas']['SessionSnapshot'] & {
  parent_chat_id?: string | null
  last_wake?: SandboxWake | null
}
export type ChatEvent = components['schemas']['ChatEvent']
export type ChatRequest = components['schemas']['ChatRequest']
export type WorkspaceEntry = components['schemas']['WorkspaceEntry']
export type ResumeResponse = components['schemas']['ResumeResponse']
export type HealthResponse = components['schemas']['HealthResponse']
export type ModelInfo = components['schemas']['ModelInfo']
export type McpServerInfo = components['schemas']['McpServerInfo']
export type LogStreamEvent = components['schemas']['LogStreamEvent']
export type LogRecordEvent = components['schemas']['LogRecordEvent']
export type AuthStatus = components['schemas']['AuthStatus']

type FilesResponse =
  operations['getFiles']['responses']['200']['content']['application/json']
type FileResponse =
  operations['getFile']['responses']['200']['content']['application/json']
type UploadResponse =
  operations['postUpload']['responses']['200']['content']['application/json']

const CLIENT_ID_HEADER = 'X-Demo-Client-ID'
const CLIENT_ID_STORAGE_KEY = 'agents-api-workbench-client-id'

/** Request failure carrying the backend's machine-readable `code`
 * (e.g. "missing_keys" → the transcript renders the key setup card). */
export class ApiError extends Error {
  code?: string
  previewText?: components['schemas']['ErrorResponse']['preview_text']
  constructor(message: string, code?: string, previewText?: components['schemas']['ErrorResponse']['preview_text']) {
    super(message)
    this.code = code
    this.previewText = previewText
  }
}

/** Broadcast so the auth gate can re-render the whole app on a lost session
 * instead of every panel surfacing its own 401. Every failure path in this
 * module goes through toApiError, so one hook covers JSON calls and both SSE
 * streams. */
export const UNAUTHORIZED_EVENT = 'workbench:unauthorized'

function toApiError(body: unknown, status: number): ApiError {
  const record =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return new ApiError(
    record && typeof record.error === 'string'
      ? record.error
      : `Request failed (${status})`,
    record && typeof record.code === 'string' ? record.code : undefined,
    record && typeof record.preview_text === 'string' ? record.preview_text : undefined
  )
}

/** Stable per-browser client id matching the backend's ^[A-Za-z0-9_-]{8,80}$. */
export function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing
  const id = `web-${crypto.randomUUID()}`
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, id)
  return id
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return body as T
}

export function fetchMemories(): Promise<
  operations['getMemories']['responses']['200']['content']['application/json']
> {
  return requestJson('/api/memories')
}

export function deleteMemory(entryId: string): Promise<
  operations['deleteMemory']['responses']['200']['content']['application/json']
> {
  return requestJson(`/api/memories/${encodeURIComponent(entryId)}`, { method: 'DELETE' })
}

export function fetchChatArchive(): Promise<{ chats: ArchivedSession[] }> {
  return requestJson('/api/chats')
}

export function importChatArchive(chats: ArchivedSession[]): Promise<{ ok: boolean }> {
  return requestJson('/api/chats/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chats }),
  })
}

/** Liveness + which credentials the backend holds (never the values). */
export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health')
}

/**
 * Control-token auth. The backend gates every other /api route behind a
 * session cookie because the sandbox's port proxy is public. `auth_required`
 * is false in local development, where the whole gate collapses to a no-op.
 */
export function fetchAuthStatus(): Promise<AuthStatus> {
  return requestJson<AuthStatus>('/api/auth/status')
}

/** Redeem the control token, or the single-use token from the `#token=` URL
 * fragment, for a 12-hour session cookie. */
export function postAuthLogin(token: string): Promise<{ authenticated: boolean }> {
  return requestJson<{ authenticated: boolean }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

/** One-time, 10-minute login URL to hand to someone else. */
export function postAuthInvite(): Promise<{ url: string; expires_in: number }> {
  return requestJson<{ url: string; expires_in: number }>('/api/auth/invite', {
    method: 'POST',
  })
}

/**
 * Key gate: hand the backend runtime credentials. The in-sandbox template
 * ships with no keys baked in — the backend keeps these in process memory
 * only. Blank fields leave the current value untouched.
 */
export function postKeys(keys: {
  e2b_api_key?: string
  openai_api_key?: string
  openai_executor_api_key?: string
}): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  })
}

/** Selectable Agents API models — OpenAI's list endpoint via the backend. */
export function fetchModels(): Promise<{ models: ModelInfo[] }> {
  return requestJson<{ models: ModelInfo[] }>('/api/models')
}

/** The MCP picker's catalog — static server metadata, no upstream call. */
export function fetchMcpServers(): Promise<
  operations['getMcpServers']['responses']['200']['content']['application/json']
> {
  return requestJson('/api/mcp/servers')
}

export function fetchStatus(
  clientId: string,
  chatId: string
): Promise<SessionSnapshot> {
  return requestJson<SessionSnapshot>(
    `/api/status?chat_id=${encodeURIComponent(chatId)}`,
    { headers: { [CLIENT_ID_HEADER]: clientId } }
  )
}

export function fetchFiles(
  clientId: string,
  chatId: string
): Promise<FilesResponse> {
  return requestJson<FilesResponse>(
    `/api/files?chat_id=${encodeURIComponent(chatId)}`,
    { headers: { [CLIENT_ID_HEADER]: clientId } }
  )
}

export function fetchFile(
  clientId: string,
  chatId: string,
  path: string
): Promise<FileResponse> {
  return requestJson<FileResponse>(
    `/api/file?chat_id=${encodeURIComponent(chatId)}&path=${encodeURIComponent(path)}`,
    { headers: { [CLIENT_ID_HEADER]: clientId } }
  )
}

/**
 * Drop-zone upload: multipart POST straight into the sandbox workspace.
 * Any file type goes; the backend caps the whole request at 100 MB and
 * refuses while the chat's sandbox is paused.
 */
// XHR, not fetch: fetch has no upload-progress signal, and multi-MB files
// into a sandbox deserve a real progress bar. onProgress gets 0..1 (upload
// bytes sent; the server-side write after 1.0 still takes a moment).
export function uploadFiles(
  clientId: string,
  chatId: string,
  files: File[],
  onProgress?: (fraction: number) => void
): Promise<UploadResponse> {
  const form = new FormData()
  for (const file of files) {
    form.append('files', file)
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/upload?chat_id=${encodeURIComponent(chatId)}`)
    xhr.setRequestHeader(CLIENT_ID_HEADER, clientId)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadResponse)
      } else {
        reject(toApiError(xhr.response, xhr.status))
      }
    }
    xhr.onerror = () => reject(new ApiError('Upload failed — network error.'))
    xhr.onabort = () => reject(new ApiError('Upload cancelled.'))
    xhr.send(form)
  })
}

export function postSteer(body: components['schemas']['SteerRequest']): Promise<components['schemas']['Interjection']> {
  return requestJson('/api/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function postCancel(
  clientId: string,
  chatId: string
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, chat_id: chatId }),
  })
}

export function postReset(
  clientId: string,
  chatId: string
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, chat_id: chatId }),
  })
}

/**
 * Fork a chat: the backend clones its sandbox + upstream session under a
 * fresh chat_id whose snapshot points back via parent_chat_id. Errors
 * (400/404/409 busy/502 attach failure) surface as ApiError like the rest.
 */
export function postFork(
  clientId: string,
  chatId: string,
  opts: {
    /** true clones as a standalone root chat (parent_chat_id=null). */
    promote?: boolean
    /** true clones at the source's own nesting level (its parent_chat_id) —
     * the decayed-chat recovery path, where the fork succeeds the dead chat
     * instead of nesting under it. */
    sibling?: boolean
  } = {}
): Promise<{ chat: SessionSnapshot; archive: ArchivedSession }> {
  return requestJson<{ chat: SessionSnapshot; archive: ArchivedSession }>('/api/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      chat_id: chatId,
      promote: opts.promote ?? false,
      sibling: opts.sibling ?? false,
    }),
  })
}

/** Snapshot the chat's sandbox now — the auto-pause-after-turn toggle. */
export function postPause(
  clientId: string,
  chatId: string
): Promise<{ ok: boolean; session: SessionSnapshot }> {
  return requestJson<{ ok: boolean; session: SessionSnapshot }>('/api/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, chat_id: chatId }),
  })
}

/**
 * Reattach a chat's backend context. Slow on a cold chat — sandbox resume +
 * executor re-registration takes tens of seconds. expired=true means the
 * upstream session is gone for good.
 */
export function postResume(
  clientId: string,
  chatId: string
): Promise<ResumeResponse> {
  return requestJson<ResumeResponse>('/api/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, chat_id: chatId }),
    // A dead-sandbox resume falls back to a full recreate, which can run for
    // minutes server-side. Cap the wait so the "resuming…" chip can't live
    // forever — on timeout the footnote offers Retry.
    signal: AbortSignal.timeout(120_000),
  })
}

/** Follow retained process logs until aborted or the chat is reset. */
export async function* streamLogs(
  clientId: string,
  chatId: string,
  signal?: AbortSignal
): AsyncGenerator<LogStreamEvent> {
  let cursor = 0
  while (!signal?.aborted) {
    const response = await fetch(
      `/api/logs?chat_id=${encodeURIComponent(chatId)}&cursor=${cursor}`,
      { headers: { [CLIENT_ID_HEADER]: clientId }, signal }
    )
    if (!response.ok || response.body === null) {
      const error = await response.json().catch(() => null)
      throw toApiError(error, response.status)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let frameEnd = buffer.indexOf('\n\n')
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd)
          buffer = buffer.slice(frameEnd + 2)
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n')
          if (data) {
            const item = JSON.parse(data) as LogStreamEvent
            if (item.type === 'log') cursor = item.cursor
            yield item
            if (item.type === 'closed') return
          }
          frameEnd = buffer.indexOf('\n\n')
        }
      }
    } finally {
      reader.releaseLock()
    }
    if (!signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * POST /api/chat and yield each SSE ChatEvent. The backend emits one JSON
 * object per `data:` line and `: keepalive` comment lines; the stream closes
 * after a terminal event (done / cancelled / error).
 */
export async function* streamChat(
  body: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || response.body === null) {
    const error = await response.json().catch(() => null)
    throw toApiError(error, response.status)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let frameEnd = buffer.indexOf('\n\n')
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            yield JSON.parse(line.slice(6)) as ChatEvent
          }
        }
        frameEnd = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function fetchMcpCredentials(): Promise<components['schemas']['McpCredentialStatus']> {
  return requestJson('/api/mcp/credentials')
}

export function saveMcpCredentials(server: string, options: Record<string, string>, chatId?: string): Promise<components['schemas']['McpCredentialStatus']> {
  return requestJson('/api/mcp/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server, options, chat_id: chatId }),
  })
}

export function setMcpSelection(chatId: string, mcp: components['schemas']['McpCapability']): Promise<SessionSnapshot> {
  return requestJson('/api/mcp/selection', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, client_id: getClientId(), mcp }),
  })
}
