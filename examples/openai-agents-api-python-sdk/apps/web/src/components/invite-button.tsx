// Multi-user, without handing anyone the sandbox's persistent control token:
// mint a single-use link that expires in 10 minutes and copy it to the
// clipboard. Whoever opens it gets their own session cookie.
//
// Everyone invited shares the backend, keys, chat list, transcripts and
// workspaces. Hidden when the backend runs unauthenticated (local dev).
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchAuthStatus, postAuthInvite } from '@/api/client'
import { Button } from '@/components/ui/button'
import { PersonsIcon } from '@/ui/primitives/icons'

export function InviteButton() {
  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const invite = useMutation({
    mutationFn: postAuthInvite,
    onSuccess: async ({ url, expires_in }) => {
      const minutes = Math.round(expires_in / 60)
      try {
        await navigator.clipboard.writeText(url)
        toast.success('Invite link copied', {
          description: `Single use, expires in ${minutes} min.`,
        })
      } catch {
        // Clipboard is permission-gated (and unavailable over plain http) —
        // fall back to showing the link so it can still be copied by hand.
        toast.success('Invite link', { description: url, duration: 30_000 })
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Invite failed.'),
  })

  if (!status.data?.auth_required) return null

  return (
    <Button
      className="text-fg-tertiary [&_svg]:text-fg-tertiary"
      disabled={invite.isPending}
      onClick={() => invite.mutate()}
      size="icon-sm"
      title="Copy a single-use invite link to this workbench"
      variant="quaternary"
    >
      <PersonsIcon />
      <span className="sr-only">Copy invite link</span>
    </Button>
  )
}
