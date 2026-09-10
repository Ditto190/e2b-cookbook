import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Outlet,
} from '@tanstack/react-router'
import { AuthGate } from '../components/auth-gate'
import { Button } from '../components/ui/button'
import TanStackQueryProvider from '../integrations/tanstack-query/root-provider'
import { ArrowLeftIcon } from '../ui/primitives/icons/arrow-left-icon'
import { GridIcon } from '../ui/primitives/icons/grid-icon'
import { HomeIcon } from '../ui/primitives/icons/home-icon'
import { RefreshIcon } from '../ui/primitives/icons/refresh-icon'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
})

// Status card copied from e2b.dev's 404 page: value-big code, muted blurb,
// description, dashed divider, then a [two half-width][one full-width]
// secondary-button footer.
function StatusCard({
  code,
  blurb,
  body,
  children,
}: {
  code: string
  blurb: string
  body: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-svh w-full items-start justify-center pt-16 md:pt-24">
      <div className="w-full max-w-md border border-stroke bg-bg-1/40 backdrop-blur-lg">
        <div className="flex flex-col space-y-1.5 p-6 pb-3 text-center">
          <span className="text-value-big">{code}</span>
          <p className="font-sans text-fg-tertiary">{blurb}</p>
        </div>
        <div className="p-6 pt-3 text-center text-fg-secondary">{body}</div>
        <div className="mt-6 flex flex-col items-center gap-1 border-t border-dashed p-6">
          {children}
        </div>
      </div>
    </main>
  )
}

function GoBackButton() {
  return (
    <Button
      className="w-full"
      onClick={() => window.history.back()}
      type="button"
      variant="secondary"
    >
      <ArrowLeftIcon />
      Go Back
    </Button>
  )
}

function RootNotFoundComponent() {
  return (
    <StatusCard
      blurb="Page not found."
      body={
        <p>
          The page you are looking for might have been removed, had its name
          changed, or is temporarily unavailable.
        </p>
      }
      code="404"
    >
      <div className="flex w-full gap-1">
        <Button asChild className="flex-1" variant="secondary">
          <a href="/">
            <HomeIcon />
            Home
          </a>
        </Button>
        <Button asChild className="flex-1" variant="secondary">
          <a href="https://e2b.dev/dashboard" rel="noreferrer" target="_blank">
            <GridIcon />
            Dashboard
          </a>
        </Button>
      </div>
      <GoBackButton />
    </StatusCard>
  )
}

function RootErrorComponent({ error }: ErrorComponentProps) {
  return (
    <StatusCard
      blurb="Something went wrong."
      body={
        <p className="break-words font-mono text-label">
          {error instanceof Error ? error.message : String(error)}
        </p>
      }
      code="Error"
    >
      <div className="flex w-full gap-1">
        <Button
          className="flex-1"
          onClick={() => window.location.reload()}
          type="button"
          variant="secondary"
        >
          <RefreshIcon />
          Reload
        </Button>
        <Button asChild className="flex-1" variant="secondary">
          <a href="/">
            <HomeIcon />
            Home
          </a>
        </Button>
      </div>
      <GoBackButton />
    </StatusCard>
  )
}

function RootComponent() {
  return (
    <TanStackQueryProvider>
      {/* Nothing below this mounts until the sandbox's control token is
          redeemed — every child query would 401 anyway. */}
      <AuthGate>
        <Outlet />
      </AuthGate>
    </TanStackQueryProvider>
  )
}
