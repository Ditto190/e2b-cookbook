// Control-token gate. The workbench runs on an E2B sandbox whose port proxy
// (https://8000-<id>.e2b.app) is public, so the backend refuses every /api
// route without a session cookie. This wrapper is what turns that 401 into a
// usable front door:
//
//  - `#token=…` in the URL (the link the sandbox terminal prints, or a share
//    link from Invite) is redeemed on mount and stripped from the address bar
//    before anything renders — a single-use token must never survive in
//    history, a bookmark, or a screenshot.
//  - Otherwise the user pastes the sandbox's control token.
//  - A session that expires mid-use re-opens the gate: api/client broadcasts
//    UNAUTHORIZED_EVENT on any 401 and we refetch.
//
// Local development configures no control token, so `auth_required` is false
// and this renders its children immediately.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  fetchAuthStatus,
  postAuthLogin,
  UNAUTHORIZED_EVENT,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { currentSandboxId, sandboxConsoleUrl } from '@/lib/e2b-links'

const TOKEN_COMMAND = 'cat ~/.config/agents-api-workbench/control-token'

/** Console link for the sandbox serving this page, or null in local dev.
 * Module scope: the hostname cannot change under a mounted gate. */
const SANDBOX_CONSOLE_URL: string | null = (() => {
  const sandboxId = currentSandboxId()
  return sandboxId ? sandboxConsoleUrl(sandboxId) : null
})()

/** The command that prints the control token, as a click-to-copy row.
 *
 * The gate renders outside the app shell, so there is no <Toaster> mounted
 * here — confirmation has to be inline. The text stays selectable so a
 * blocked clipboard (permission denied, plain http) is only a nuisance. */
function TokenCommand() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  return (
    <button
      className="group flex w-full cursor-pointer items-center justify-between gap-3 border border-stroke bg-bg-highlight px-3 py-2 text-left transition-colors hover:border-stroke-active"
      onClick={() => {
        navigator.clipboard
          .writeText(TOKEN_COMMAND)
          .then(() => setState('copied'))
          .catch(() => setState('failed'))
      }}
      title="Copy this command"
      type="button"
    >
      <code className="truncate font-mono text-fg-secondary text-label">
        {TOKEN_COMMAND}
      </code>
      <span className="shrink-0 text-fg-tertiary text-label group-hover:text-fg">
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Copy by hand'
            : 'Copy'}
      </span>
    </button>
  )
}

/** Pull `#token=…` out of the URL and erase it from the address bar.
 *
 * Module scope, not component state: a single-use token must be stripped
 * before the first paint, and it has to survive React's StrictMode remount —
 * a component-local read would lose it the second time round, when the hash
 * is already gone. */
const HASH_TOKEN: string | null = (() => {
  const hash = window.location.hash
  if (!hash.startsWith('#token=')) return null
  const token = decodeURIComponent(hash.slice('#token='.length))
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search
  )
  return token || null
})()

export function AuthGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const statusQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    // The cookie is 12h; nothing else invalidates this but the 401 broadcast.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const login = useMutation({
    mutationFn: postAuthLogin,
    onSuccess: () => {
      setToken('')
      queryClient.setQueryData(['auth-status'], {
        auth_required: true,
        authenticated: true,
      })
      // Health was fetched (and 401'd) before the session existed.
      queryClient.invalidateQueries()
    },
  })

  // Redeem the URL token exactly once, as soon as we know auth is on.
  const redeemedRef = useRef(false)
  useEffect(() => {
    if (
      !HASH_TOKEN ||
      redeemedRef.current ||
      statusQuery.data?.authenticated !== false
    ) {
      return
    }
    redeemedRef.current = true
    login.mutate(HASH_TOKEN)
  }, [statusQuery.data, login])

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.invalidateQueries({ queryKey: ['auth-status'] })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [queryClient])

  // First paint: say nothing rather than flashing the gate at someone who is
  // already signed in.
  if (!statusQuery.data) return null
  if (!statusQuery.data.auth_required || statusQuery.data.authenticated) {
    return <>{children}</>
  }
  // A URL token is in flight — the gate would flash for one round trip.
  if (HASH_TOKEN && login.isPending) return null

  return (
    <main className="flex min-h-svh w-full items-start justify-center pt-16 md:pt-24">
      <form
        className="w-full max-w-md border border-stroke bg-bg-1 p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (token.trim() && !login.isPending) login.mutate(token.trim())
        }}
      >
        <h1 className="text-fg text-headline-small">Control token required</h1>
        <p className="mt-2 text-body text-fg-tertiary">
          This workbench is reachable at a public sandbox URL, so it is locked
          to whoever holds its control token. Open the link printed in the
          sandbox terminal, or paste the token below.
        </p>
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-fg-tertiary text-label-highlight">
            Control token
          </span>
          <input
            autoComplete="off"
            autoFocus
            className="w-full border border-stroke bg-bg-highlight px-3 py-2 font-mono text-body outline-none placeholder:text-fg-tertiary focus-visible:border-stroke-active focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setToken(event.target.value)}
            placeholder="Printed by the sandbox terminal"
            type="password"
            value={token}
          />
        </label>
        {login.isError && (
          <p className="mt-2 text-accent-error-highlight text-label">
            {login.error instanceof Error
              ? login.error.message
              : 'Login failed.'}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button disabled={!token.trim() || login.isPending} type="submit">
            {login.isPending ? 'Checking…' : 'Unlock'}
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-dashed pt-4">
          <span className="text-fg-tertiary text-label">
            Don't have the token? Print it from inside the sandbox:
          </span>
          <TokenCommand />
          {SANDBOX_CONSOLE_URL && (
            <p className="text-fg-tertiary text-label">
              No terminal open?{' '}
              <a
                className="underline decoration-fg/50 underline-offset-2 transition-colors hover:text-accent-main-highlight hover:decoration-accent-main-highlight"
                href={SANDBOX_CONSOLE_URL}
                rel="noreferrer"
                target="_blank"
              >
                open this sandbox in the E2B dashboard
              </a>{' '}
              and paste the command into its Terminal tab.
            </p>
          )}
        </div>
      </form>
    </main>
  )
}
