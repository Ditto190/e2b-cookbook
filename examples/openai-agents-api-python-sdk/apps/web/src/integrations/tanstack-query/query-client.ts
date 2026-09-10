import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient()

// Router context factory — lives outside the provider component file so Fast
// Refresh can preserve component state when the provider changes.
export function getContext() {
  return {
    queryClient,
  }
}
