// Multi-session turn store. Stream state lives at module scope, keyed by
// chat id — NOT in component state — so a streaming turn keeps running when
// the user switches to another chat or starts a new one. The component only
// subscribes to the chat it's currently viewing.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { components } from '@/api/schema'
import {
  ApiError,
  type ChatEvent,
  getClientId,
  postCancel,
  postPause,
  postSteer,
  type SessionSnapshot,
  streamChat,
} from '@/api/client'
import { agentRequestFields } from '@/lib/agent-settings'
import { queryClient } from '@/integrations/tanstack-query/query-client'
import { getAutoPause } from '@/lib/settings'
import { announceSandboxWake } from '@/lib/wake-toast'
import {
  type ArchivedSession,
  bumpSession,
  markSessionExpired,
  setSessionMeta,
  upsertSession,
} from '@/lib/sessions'

export type ActivityRow = components['schemas']['ArchivedActivity']
export type Turn = components['schemas']['ArchivedTurn']

export function isTurnForkable(turn: Turn | undefined): boolean {
  return (
    turn?.outcome === 'error' &&
    (turn.forkable === true || turn.errorCode === 'decayed')
  )
}

export function isTurnTerminal(turn: Turn | undefined): boolean {
  return (
    turn?.outcome === 'error' &&
    (turn.terminal === true ||
      turn.errorCode === 'decayed' ||
      turn.errorCode === 'expired')
  )
}

export type ChatState = {
  turns: Turn[]
  active: boolean
  /** Prompts accepted while a turn was streaming — flushed FIFO as turns
   * end. In-memory only: a reload drops the backlog (nothing was sent). */
  queued: string[]
  /** Local admission waits; text comes from the coordinator's redacted preview. */
  steering?: { submission_id: string; text: string }[]
}

const EMPTY: ChatState = { turns: [], active: false, queued: [] }
const states = new Map<string, ChatState>()
const listeners = new Set<() => void>()
const aborts = new Map<string, AbortController>()
let nextTurnId = 1
// Which chat is on screen — turns finishing anywhere else mark their chat
// unseen until the user visits it. The viewed chat never gets the badge:
// being in that window counts as seeing it, even if the tab is hidden.
let viewedChatId: string | null = null
const unseen = new Set<string>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

/** The route tells the store what's on screen; visiting clears the badge. */
export function setViewedChat(chatId: string) {
  viewedChatId = chatId
  if (unseen.delete(chatId)) {
    notify()
  }
}

/** Chats whose last turn finished while the user was elsewhere. */
export function useUnseenChatIds(): string {
  return useSyncExternalStore(subscribe, () => [...unseen].sort().join(','))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getState(chatId: string): ChatState {
  return states.get(chatId) ?? EMPTY
}

/** Subscribe a component to one chat's turns + streaming flag. */
export function useChatState(chatId: string): ChatState {
  return useSyncExternalStore(subscribe, () => getState(chatId))
}

// Mirror transcripts into the in-memory sidebar cache, debounced per chat —
// token deltas arrive far too fast to persist each one.
const mirrorTimers = new Map<string, number>()

function scheduleMirror(chatId: string) {
  if (mirrorTimers.has(chatId)) {
    return
  }
  mirrorTimers.set(
    chatId,
    window.setTimeout(() => {
      mirrorTimers.delete(chatId)
      upsertSession(chatId, getState(chatId).turns)
    }, 400)
  )
}

function flushMirror(chatId: string) {
  const timer = mirrorTimers.get(chatId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    mirrorTimers.delete(chatId)
  }
  upsertSession(chatId, getState(chatId).turns)
}

function setState(chatId: string, next: ChatState) {
  states.set(chatId, next)
  for (const listener of listeners) {
    listener()
  }
  scheduleMirror(chatId)
}

function patchTurn(chatId: string, turnId: number, patch: (turn: Turn) => Turn) {
  const state = getState(chatId)
  setState(chatId, {
    ...state,
    turns: state.turns.map((turn) => (turn.id === turnId ? patch(turn) : turn)),
  })
}

/** Refresh shared state without replacing this browser's live stream. */
export function seedChat(chatId: string, turns: Turn[]) {
  if (aborts.has(chatId)) {
    return
  }
  const previous = getState(chatId)
  if (previous.turns === turns) {
    return
  }
  const lastMessage = turns.findLast((turn) => turn.prompt !== '')
  const previousMessage = previous.turns.findLast((turn) => turn.prompt !== '')
  const completed =
    lastMessage !== undefined &&
    lastMessage.outcome !== 'running' &&
    (lastMessage.id !== previousMessage?.id ||
      lastMessage.outcome !== previousMessage?.outcome)
  // Completion is shared; whether it has been read belongs to this viewer.
  if (completed && viewedChatId !== chatId) {
    unseen.add(chatId)
  }
  nextTurnId = Math.max(nextTurnId, ...turns.map((turn) => turn.id + 1))
  const active = turns.at(-1)?.outcome === 'running'
  states.set(chatId, { ...previous, turns, active })
  notify()
  // A prompt queued behind another viewer's turn must also resume when
  // that remote turn finishes, even if this chat is no longer on screen.
  if (previous.active && !active && lastMessage?.outcome !== 'error') {
    flushQueue(chatId)
  }
}

/** Hydrate background chats too: sidebar activity cannot depend on selection. */
export function syncSharedChats(chats: ArchivedSession[]) {
  for (const chat of chats) {
    seedChat(chat.id, chat.turns)
  }
}

export function dropChat(chatId: string) {
  cancelSteeringWaits(chatId)
  aborts.get(chatId)?.abort()
  aborts.delete(chatId)
  const timer = mirrorTimers.get(chatId)
  if (timer !== undefined) window.clearTimeout(timer)
  mirrorTimers.delete(chatId)
  unseen.delete(chatId)
  states.delete(chatId)
  for (const listener of listeners) {
    listener()
  }
}

function applyEvent(chatId: string, turnId: number, event: ChatEvent) {
  if (event.type === 'usage') {
    const archivedTurn = getState(chatId).turns.find((turn) => turn.upstreamTurnId === event.turn_id)
    if (!archivedTurn) return
    patchTurn(chatId, archivedTurn.id, (turn) => ({ ...turn, usage: event.usage }))
    return
  }
  if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
    patchTurn(chatId, turnId, (turn) => {
      return {
        ...turn,
        ...(event.turn_id ? { upstreamTurnId: event.turn_id } : {}),
        ...(event.usage ? { usage: event.usage } : {}),
      }
    })
  }
  switch (event.type) {
    case 'interjection': {
      const state = getState(chatId)
      const owner = state.turns.find((turn) => turn.interjections?.some((row) => row.submission_id === event.submission_id))
      patchTurn(chatId, owner?.id ?? turnId, (turn) => {
        const rows = turn.interjections ?? []
        const exists = rows.some((row) => row.submission_id === event.submission_id)
        return { ...turn, interjections: exists
          ? rows.map((row) => row.submission_id === event.submission_id ? event : row)
          : [...rows, event] }
      })
      break
    }
    case 'turn_started': {
      const state = getState(chatId)
      setState(chatId, {
        ...state,
        turns: [
          ...state.turns.map((turn) => turn.id === turnId ? {
            ...turn, outcome: event.previous_outcome, phase: null, error: event.previous_error,
            ...(event.previous_turn_id ? { upstreamTurnId: event.previous_turn_id } : {}),
            ...(event.previous_usage ? { usage: event.previous_usage } : {}),
          } : turn),
          { id: nextTurnId++, prompt: event.prompt, from_submission_id: event.from_submission_id,
            phase: 'Following steer-started turn', activities: [], text: '', outcome: 'running' },
        ],
      })
      break
    }
    case 'state':
      patchTurn(chatId, turnId, (turn) => ({ ...turn, phase: event.message }))
      break
    case 'activity': {
      const row: ActivityRow = {
        id: event.id,
        tone: event.tone,
        label: event.label,
        detail: event.detail,
        durationMs: event.duration_ms,
        agent_id: event.agent_id,
      }
      patchTurn(chatId, turnId, (turn) => {
        // Same item over time (running → finished): update the row in place
        // so a command occupies ONE line from start to completion.
        const existing = event.id
          ? turn.activities.findIndex((activity) => activity.id === event.id)
          : -1
        const activities =
          existing >= 0
            ? turn.activities.map((activity, index) =>
                index === existing ? row : activity
              )
            : [...turn.activities, row]
        return { ...turn, phase: null, activities }
      })
      break
    }
    case 'delta':
      patchTurn(chatId, turnId, (turn) => ({
        ...turn,
        text: turn.text + event.text,
      }))
      break
    case 'text':
      patchTurn(chatId, turnId, (turn) => ({ ...turn, text: event.text }))
      break
    case 'reasoning':
      patchTurn(chatId, turnId, (turn) => ({
        ...turn,
        reasoning: 'text' in event ? event.text : (turn.reasoning ?? '') + event.delta,
      }))
      break
    case 'done':
      patchTurn(chatId, turnId, (turn) => ({
        ...turn,
        phase: null,
        outcome: 'done',
      }))
      // The terminal snapshot names the chat's backend identities — the
      // sidebar labels rows by sandbox id and nests forks under their
      // parent. Cast: the widened SessionSnapshot carries parent_chat_id
      // until the generated spec does.
      setSessionMeta(chatId, {
        sandboxId: event.session.sandbox,
        sessionId: event.session.session_id,
        parentChatId: (event.session as SessionSnapshot).parent_chat_id,
        capabilities: event.session.capabilities,
      })
      // Background-chat path of the wake toast: turns streaming in unviewed
      // chats never hit the status poll, so the terminal snapshot carries it.
      announceSandboxWake(event.session as SessionSnapshot)
      // Push the terminal snapshot into the status cache so the lifecycle
      // pill flips (paused → connected/countdown) the moment the turn ends
      // instead of waiting out the next status poll.
      queryClient.setQueryData(['status', chatId], event.session)
      break
    case 'cancelled':
      patchTurn(chatId, turnId, (turn) => ({
        ...turn,
        phase: null,
        outcome: 'cancelled',
      }))
      break
    case 'error':
      patchTurn(chatId, turnId, (turn) => ({
        ...turn,
        phase: null,
        outcome: 'error',
        error: event.message,
        errorCode: event.code,
        forkable: event.forkable,
        terminal: event.terminal,
      }))
      if (event.code === 'expired') {
        markSessionExpired(chatId, event.forkable === true)
      }
      break
    default:
      break
  }
}

// Cross-tab/fork 409s ("A turn is already running.") park the turn and
// re-POST on this cadence instead of surfacing an error bubble; past the
// cap the 409 falls through as a regular error.
const TURN_WAIT_RETRY_MS = 1_500
const TURN_WAIT_LIMIT_MS = 120_000

/** Drop one parked prompt (the ✕ on its queued chip). */
export function removeQueuedPrompt(chatId: string, index: number) {
  const state = getState(chatId)
  setState(chatId, {
    ...state,
    queued: state.queued.filter((_, i) => i !== index),
  })
}

/** Send a prompt into the given chat. Every prompt joins the back of the
 * chat's queue; if the chat is idle the head flushes into a turn right away,
 * otherwise it stays parked and flushes FIFO as each turn ends. This single
 * path is what keeps send order — the end-of-turn chain and a fresh send
 * both go through the same pop. */
export function sendChatPrompt(chatId: string, prompt: string) {
  const state = getState(chatId)
  setState(chatId, { ...state, queued: [...state.queued, prompt] })
  if (!state.active) {
    flushQueue(chatId)
  }
}

const steeringWaits = new Map<string, Set<{ cancelled: boolean }>>()

function cancelSteeringWaits(chatId: string) {
  for (const wait of steeringWaits.get(chatId) ?? []) wait.cancelled = true
  steeringWaits.delete(chatId)
  const state = states.get(chatId)
  if (state?.steering?.length) setState(chatId, { ...state, steering: [] })
}

/** Retry only a conclusive admission rejection, keeping the same submission ID. */
export async function steerChatPrompt(chatId: string, text: string, submissionId = crypto.randomUUID()) {
  const wait = { cancelled: false }
  const waits = steeringWaits.get(chatId) ?? new Set()
  waits.add(wait)
  steeringWaits.set(chatId, waits)
  const deadline = Date.now() + TURN_WAIT_LIMIT_MS
  const state = getState(chatId)
  setState(chatId, { ...state, steering: [...(state.steering ?? []), { submission_id: submissionId, text: 'Sending message…' }] })
  try {
    while (!wait.cancelled) {
      const turnId = getState(chatId).turns.at(-1)?.id
      try {
        const record = await postSteer({ chat_id: chatId, client_id: getClientId(), text, submission_id: submissionId })
        if (wait.cancelled) return
        // SSE or shared polling may already have a newer status than this response.
        const known = getState(chatId).turns.some((turn) => turn.interjections?.some((row) => row.submission_id === submissionId))
        if (!known && turnId !== undefined) applyEvent(chatId, turnId, { type: 'interjection', ...record })
        return
      } catch (error) {
        if (wait.cancelled) return
        if (!(error instanceof ApiError && error.code === 'no_active_turn')) {
          toast.error('Interjection status could not be retrieved. Check the transcript before sending again.')
          return
        }
        const previewText = error.previewText
        if (previewText !== undefined) {
          const current = getState(chatId)
          setState(chatId, { ...current, steering: current.steering?.map((row) =>
            row.submission_id === submissionId ? { ...row, text: previewText } : row
          ) })
        }
        if (!getState(chatId).active) {
          sendChatPrompt(chatId, text)
          return
        }
        if (Date.now() >= deadline) {
          toast.error('The agent did not become ready to steer. Please send your message again.')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  } finally {
    const current = states.get(chatId)
    if (current?.steering?.some((row) => row.submission_id === submissionId)) {
      setState(chatId, { ...current, steering: current.steering.filter((row) => row.submission_id !== submissionId) })
    }
    waits.delete(wait)
    if (steeringWaits.get(chatId) === waits && waits.size === 0) steeringWaits.delete(chatId)
  }
}

/** Pop the queue head into a running turn (no-op while a turn streams). */
function flushQueue(chatId: string) {
  const state = getState(chatId)
  const head = state.queued[0]
  if (state.active || head === undefined) {
    return
  }
  setState(chatId, { ...state, queued: state.queued.slice(1) })
  void runTurn(chatId, head)
}

/** Run one turn in the given chat. Turns in different chats run in parallel. */
async function runTurn(chatId: string, prompt: string) {
  const agentFields = agentRequestFields()
  const clientId = getClientId()
  let turnId = nextTurnId++
  const state = getState(chatId)
  setState(chatId, {
    ...state,
    turns: [
      ...state.turns,
      {
        id: turnId,
        prompt,
        phase: 'Starting agent',
        activities: [],
        text: '',
        reasoning: null,
        outcome: 'running',
      },
    ],
    active: true,
  })
  // Reorder NOW — the sidebar orders by latest turn message, so a chat moves
  // to the top the moment a prompt is sent, never when a stream/tool settles.
  flushMirror(chatId)
  if (state.turns.length === 0) {
    setSessionMeta(chatId, { capabilities: agentFields.capabilities })
  }
  bumpSession(chatId)
  const controller = new AbortController()
  aborts.set(chatId, controller)
  // Shared activity can lag a poll — the backend turn lock can
  // still be held by another tab, a cancel still draining, or a fork whose
  // clone is mid-turn. Those 409 before any event arrives, so they're safe
  // to retry: park the turn on a waiting phase and re-POST until the lock
  // frees or the wait cap expires.
  const waitStart = Date.now()
  let received = false
  let finished = false
  let adopted = false
  function finishTurn() {
    if (finished) return
    finished = true
    aborts.delete(chatId)
    setState(chatId, { ...getState(chatId), active: false })
    flushMirror(chatId)
    if (viewedChatId !== chatId) {
      unseen.add(chatId)
      notify()
    }
    const after = getState(chatId)
    // Auto-flush the backlog - but not off an errored turn (an expired chat
    // or dead key would burn the whole queue on the same failure). Errored
    // backlogs stay visible as queued chips; the user's next send resumes
    // the FIFO. Flushing also preempts auto-pause: snapshotting between
    // queued turns would pay a full resume on the very next POST.
    const failed =
      after.turns.find((turn) => turn.id === turnId)?.outcome === 'error'
    if (after.queued.length > 0 && !failed && !controller.signal.aborted) {
      flushQueue(chatId)
    }
    // Opt-in economy mode: snapshot the sandbox as soon as the turn ends
    // instead of letting it idle out its TTL. Next message auto-resumes.
    else if (getAutoPause()) {
      autoPausing.add(chatId)
      notify()
      postPause(getClientId(), chatId)
        .then((result) => {
          // Same cache write the manual pause mutation does - the pill shows
          // "paused" as soon as the snapshot lands, not on the next poll.
          queryClient.setQueryData(['status', chatId], result.session)
        })
        .catch(() => undefined)
        .finally(() => {
          autoPausing.delete(chatId)
          notify()
        })
    }
  }
  try {
    while (true) {
      try {
        // Agent draft rides along on every turn; the backend applies it only
        // while the chat has no upstream session (config binds at creation).
        for await (const event of streamChat(
          {
            client_id: clientId,
            chat_id: chatId,
            prompt,
            ...agentFields,
          },
          controller.signal
        )) {
          received = true
          if (finished && event.type !== 'usage') continue
          applyEvent(chatId, turnId, event)
          if (event.type === 'turn_started') {
            adopted = true
            turnId = getState(chatId).turns.at(-1)!.id
          }
          if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
            if (!adopted || event.run_complete) finishTurn()
          }
        }
        break
      } catch (error) {
        const busy =
          error instanceof ApiError &&
          error.code === 'turn_running' &&
          !received &&
          Date.now() - waitStart < TURN_WAIT_LIMIT_MS
        if (!busy) {
          throw error
        }
        patchTurn(chatId, turnId, (turn) => ({
          ...turn,
          phase: 'Waiting for the previous turn to finish…',
        }))
        await new Promise((resolve) => setTimeout(resolve, TURN_WAIT_RETRY_MS))
      }
    }
    if (finished) return
    // Stream closed without a terminal event (e.g. proxy drop) — surface it.
    patchTurn(chatId, turnId, (turn) =>
      turn.outcome === 'running'
        ? {
            ...turn,
            phase: null,
            outcome: 'error',
            error: 'The event stream ended unexpectedly.',
          }
        : turn
    )
  } catch (error) {
    if (finished) return
    patchTurn(chatId, turnId, (turn) => ({
      ...turn,
      phase: null,
      outcome: 'error',
      error: error instanceof Error ? error.message : String(error),
      // "missing_keys" swaps the raw error line for the key setup card
      errorCode: error instanceof ApiError ? error.code : undefined,
    }))
  } finally {
    finishTurn()
  }
}

// Chats whose end-of-turn auto-pause snapshot is in flight — the lifecycle
// pill shows "pausing…" for these just like a manual pause.
const autoPausing = new Set<string>()

/** Ids of chats currently auto-pausing (serialized for stable snapshots). */
export function useAutoPausingChatIds(): string {
  return useSyncExternalStore(subscribe, () => [...autoPausing].sort().join(','))
}

/** Abort the chat's stream client-side and ask the backend to cancel it. */
export function cancelChatTurn(chatId: string) {
  cancelSteeringWaits(chatId)
  postCancel(getClientId(), chatId).catch(() => undefined)
}

/** Ids of chats with a turn streaming right now (sidebar badges). */
export function useActiveChatIds(): string {
  // Serialized so useSyncExternalStore gets a stable primitive snapshot.
  return useSyncExternalStore(subscribe, () => {
    const ids: string[] = []
    for (const [id, state] of states) {
      if (state.active) {
        ids.push(id)
      }
    }
    return ids.sort().join(',')
  })
}
