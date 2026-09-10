import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { fetchHealth, postKeys } from '@/api/client'
import { Button } from '@/components/ui/button'
import { sendChatPrompt } from '@/lib/chat-store'
import { cn } from '@/lib/utils'
import { ExternalLinkIcon, EyeClosedIcon, EyeOpenIcon } from '@/ui/primitives/icons'

const FIELD_CLASSES =
  'w-full border border-stroke bg-bg-highlight px-3 py-2 pr-10 font-mono text-body outline-none placeholder:text-fg-tertiary focus-visible:border-stroke-active focus-visible:ring-[3px] focus-visible:ring-ring/50'

// One credential field: masked by default with a show/hide toggle, an optional
// "where to get it" link, and a hint line. Shared with the MCP picker so a
// server's API key asks the same way the OpenAI/E2B keys do.
export function KeyField({
  label,
  href,
  hrefLabel,
  placeholder,
  value,
  onChange,
  hint,
  secret = true,
}: {
  label: string
  href?: string
  hrefLabel?: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  hint?: string
  /** False for plain config values (a path, a region): no masking, no toggle. */
  secret?: boolean
}) {
  const id = useId()
  const [visible, setVisible] = useState(!secret)

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-fg-tertiary text-label-highlight">
          {label}
        </label>
        {href && (
          <a
            className="inline-flex items-center gap-1 text-fg text-label hover:underline"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {hrefLabel}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        )}
      </span>
      <div className="relative">
        <input
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          autoComplete="off"
          className={cn(FIELD_CLASSES, !secret && 'pr-3')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          type={visible ? 'text' : 'password'}
          value={value}
        />
        {secret && <Button
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 -translate-y-1/2 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => setVisible((current) => !current)}
          size="icon-sm"
          title={visible ? 'Hide key' : 'Show key'}
          type="button"
          variant="quaternary"
        >
          {visible ? <EyeClosedIcon aria-hidden /> : <EyeOpenIcon aria-hidden />}
        </Button>}
      </div>
      {hint && <span id={`${id}-hint`} className="text-fg-tertiary text-label">{hint}</span>}
    </div>
  )
}

export function KeySetupCard({
  chatId,
  prompt,
  retry,
  className,
  settings = false,
  onSaved,
}: {
  chatId?: string
  prompt?: string
  /** Only the newest failed turn retries — older cards just save keys. */
  retry?: boolean
  className?: string
  settings?: boolean
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const [e2bKey, setE2bKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [executorKey, setExecutorKey] = useState('')

  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth })

  const submit = useMutation({
    mutationFn: () =>
      postKeys({
        ...(e2bKey.trim() ? { e2b_api_key: e2bKey.trim() } : {}),
        ...(openaiKey.trim() ? { openai_api_key: openaiKey.trim() } : {}),
        ...(executorKey.trim()
          ? { openai_executor_api_key: executorKey.trim() }
          : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['health'], data)
      setE2bKey('')
      setOpenaiKey('')
      setExecutorKey('')
      void queryClient.invalidateQueries({ queryKey: ['models'] })
      onSaved?.()
      if (retry && chatId && prompt && data.has_e2b_key && data.has_openai_key) {
        sendChatPrompt(chatId, prompt)
      }
    },
  })

  if (!health.data) {
    return <p role="status" className="p-4 text-body text-fg-tertiary">
      {health.isError ? 'Could not load API key settings. Please try again.' : 'Loading API key settings…'}
    </p>
  }
  const missingE2b = !health.data.has_e2b_key
  const missingOpenai = !health.data.has_openai_key

  // Keys arrived (this card or another) — collapse to a quiet confirmation.
  if (!settings && !missingE2b && !missingOpenai) {
    return (
      <p className="font-mono text-fg-tertiary text-label">
        ✓ API keys configured.
      </p>
    )
  }

  const submittable =
    (missingE2b ? e2bKey.trim().length > 0 : true) &&
    (missingOpenai ? openaiKey.trim().length > 0 : true) &&
    Boolean(e2bKey.trim() || openaiKey.trim() || executorKey.trim())

  return (
    <div className={cn('max-w-md border border-stroke bg-bg-1 p-4', className)}>
      {!settings && (
        <h3 className="mb-1 text-fg text-headline-small">API key needed</h3>
      )}
      <p className="mb-3 text-body text-fg-tertiary">
        {settings && !missingE2b && !missingOpenai
          ? 'Update your API keys below. Leave a field blank to keep its current value.'
          : `Add the missing API key${missingE2b && missingOpenai ? 's' : ''} to start chatting.`}
        {' '}Keys stay in app memory only, never stored or logged.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (submittable && !submit.isPending) submit.mutate()
        }}
      >
        {(settings || missingE2b) && (
          <KeyField
            href="https://e2b.dev/dashboard"
            hrefLabel="Get one E2B Dashboard → API Keys"
            label="E2B API key"
            onChange={setE2bKey}
            placeholder={missingE2b ? "e2b_…" : "Configured — enter a replacement"}
            value={e2bKey}
          />
        )}
        {(settings || missingOpenai) && (
          <>
            <KeyField
              hint="Stays in this backend — it drives the Agents API session and never enters a sandbox."
              href="https://platform.openai.com/api-keys"
              hrefLabel="Get one platform.openai.com"
              label="OpenAI API key (Agents API preview)"
              onChange={setOpenaiKey}
              placeholder={missingOpenai ? "sk-proj-…" : "Configured — enter a replacement"}
              value={openaiKey}
            />
            {/* Optional second key, same OpenAI project. This is the only
                credential that reaches the sandbox, where agent-authored code
                can read it — worth scoping down separately. */}
            <KeyField
              hint={health.data.has_executor_key
                ? "Leave blank to keep the current executor key. Used by the agent inside the sandbox."
                : "Optional. Used by the agent inside the sandbox. Use the same OpenAI project; leave blank to reuse the key above."}
              href="https://platform.openai.com/agents?tab=environments&environment_view=keys"
              hrefLabel="Scoped project key"
              label="OpenAI executor key"
              onChange={setExecutorKey}
              placeholder={health.data.has_executor_key ? "Configured — enter a replacement" : "sk-proj-… (executor only)"}
              value={executorKey}
            />
          </>
        )}
        {submit.isError && (
          <p className="text-accent-error-highlight text-label">
            {submit.error instanceof Error
              ? submit.error.message
              : 'Failed to save keys.'}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={!submittable || submit.isPending} type="submit">
            {submit.isPending
              ? 'Saving…'
              : retry
                ? 'Save keys & retry'
                : 'Save keys'}
          </Button>
        </div>
      </form>
    </div>
  )
}
