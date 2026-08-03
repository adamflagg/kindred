import { QueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'

// Clean up legacy localStorage persistence (removed in this version)
localStorage.removeItem('bunking-query-cache')

// Create query client with simplified caching strategy.
// Most data uses these 30/60 min defaults. Some user-editable data overrides at
// query level via `userDataOptions` — but that is a deliberate choice, not the
// expected one: a surface whose writes all go through this app should inherit
// these defaults and invalidate on mutation instead. See `frontend/CLAUDE.md`.
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
 * All query key prefixes that depend on synced CampMinder data.
 * When a sync completes, all queries with these prefixes are invalidated.
 * Add new prefixes here when creating query keys for sync-derived data.
 */
const SYNC_DEPENDENT_PREFIXES = [
  // Sessions (Tier 1)
  'sessions',
  'all-sessions',
  'session',
  'session-stats',
  'session-groups',
  'session-programs',
  // Campers (Tier 1)
  'campers',
  'all-campers',
  'camper',
  'camper-history',
  'enrolled-campers',
  // Bunks (Tier 1)
  'bunks',
  'bunk-assignments',
  // Bunk requests (Tier 2 but sync-dependent)
  'bunk-requests',
  'bunk-request-status',
  // Historical (Tier 1)
  'historical-bunking',
  // Staff (Tier 1)
  'bunk-staff',
  // Metrics (Tier 1 — covers retention, registration, velocity, forecast, day1, etc.)
  'metrics',
  // Sync status
  'sync-status',
  // Weekend lodging (Tier 1) — the lodging ingest writes assignments, requests
  // and registry rows that all three of these read. Omitted until #1965, so a
  // completed sync refreshed nothing it had just written.
  'weekend-sessions',
  'weekend-summary',
  'weekend-roster',
] as const

/**
 * Invalidate all sync-related data caches.
 * Call this after sync operations complete to ensure fresh data.
 */
export const invalidateSyncData = () => {
  fetch('/api/metrics/cache/invalidate', { method: 'POST' }).catch(() => {})
  for (const prefix of SYNC_DEPENDENT_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [prefix] })
  }
}
