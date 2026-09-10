// Deep links into the E2B console for the sandbox this workbench runs in.
//
// A console URL for one sandbox is project-scoped
// (/project/<slug>/sandboxes/<id>/…) and the browser cannot know that slug:
// the workbench only ever holds an E2B API key, and no public API maps a key
// to a project. The console solves it itself with a slug-free resolver,
// /inspect/sandbox/<id>, which looks the sandbox up across the signed-in
// user's projects and redirects into the right one. Linking there is what
// makes these links work for whoever opens the workbench instead of only for
// the team that wrote it.

const CONSOLE_ORIGIN = 'https://console.e2b.dev'

/** Sandbox id read off the E2B port-proxy hostname (`8000-<id>.e2b.app`).
 *
 * Null in local development, where the workbench is served from localhost —
 * every caller treats that as "no dashboard link to offer". Nothing secret
 * is derived here: the id is already public in the URL bar. */
export function currentSandboxId(): string | null {
  const match = /^\d+-([a-z0-9]{16,})\./.exec(window.location.hostname)
  return match?.[1] ?? null
}

/** Console page for a sandbox, via the resolver — lands on its Monitoring
 * tab, with Logs / Terminal / Filesystem one click away. */
export function sandboxConsoleUrl(sandboxId: string): string {
  return `${CONSOLE_ORIGIN}/inspect/sandbox/${sandboxId}`
}
