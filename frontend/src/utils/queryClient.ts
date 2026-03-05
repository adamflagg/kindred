import { QueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'

// Clean up legacy localStorage persistence (removed in this version)
localStorage.removeItem('bunking-query-cache')

// Create query client with simplified caching strategy
// Most data uses 30/60 min defaults; user-editable data overrides at query level
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Simple defaults - most camp data changes infrequently
      staleTime: 30 * 60 * 1000, // 30 minutes
      gcTime: 60 * 60 * 1000, // 60 minutes (cache retention)

      // Don't refetch on window focus for static data
      refetchOnWindowFocus: false,

      // Don't refetch on reconnect
      refetchOnReconnect: false,

      // Retry failed requests up to 3 times
      retry: (failureCount, error) => {
        // Don't retry on 401 errors (PocketBase v0.23+ uses status at top level)
        const httpError = error as { status?: number } | null
        if (httpError?.status === 401) {
          return false
        }
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Global error handler for mutations
      onError: (error) => {
        // Handle 401 errors (PocketBase v0.23+ uses status at top level)
        const httpError = error as { status?: number } | null
        if (httpError?.status === 401) {
          pb.authStore.clear()
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`
          }
        }
      },
    },
  },
})

// Helper to manually invalidate cache (e.g., after sync)
export const invalidateCache = () => {
  void queryClient.invalidateQueries()
}

// Helper to clear all cache
export const clearCache = () => {
  queryClient.clear()
  // Also invalidate server-side metrics cache (fire-and-forget)
  fetch('/api/metrics/cache/invalidate', { method: 'POST' }).catch(() => {})
}

/**
 * Invalidate all sync-related data caches.
 * Call this after sync operations complete to ensure fresh data.
 * This invalidates Tier 1 (sync data) queries that may have changed.
 */
export const invalidateSyncData = () => {
  // Invalidate server-side metrics cache (fire-and-forget)
  fetch('/api/metrics/cache/invalidate', { method: 'POST' }).catch(() => {})

  // Sessions
  void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  void queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
  void queryClient.invalidateQueries({ queryKey: ['session'] })
  void queryClient.invalidateQueries({ queryKey: ['session-stats'] })

  // Campers and persons
  void queryClient.invalidateQueries({ queryKey: ['campers'] })
  void queryClient.invalidateQueries({ queryKey: ['all-campers'] })
  void queryClient.invalidateQueries({ queryKey: ['camper'] })
  void queryClient.invalidateQueries({ queryKey: ['camper-history'] })

  // Historical data
  void queryClient.invalidateQueries({ queryKey: ['historical-bunking'] })

  // Bunks and assignments
  void queryClient.invalidateQueries({ queryKey: ['bunks'] })
  void queryClient.invalidateQueries({ queryKey: ['bunk-assignments'] })

  // Bunk requests
  void queryClient.invalidateQueries({ queryKey: ['bunk-requests'] })
  void queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] })

  // Metrics (depends on synced data)
  void queryClient.invalidateQueries({ queryKey: ['metrics'] })

  // Sync status
  void queryClient.invalidateQueries({ queryKey: ['sync-status'] })
  void queryClient.invalidateQueries({ queryKey: ['sync-status-api'] })
}
