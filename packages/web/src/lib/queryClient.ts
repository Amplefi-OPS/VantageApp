import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      console.error('[QueryCache] Unhandled query error:', error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      console.error('[MutationCache] Unhandled mutation error:', error)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      refetchOnWindowFocus: false,
    },
  },
})
