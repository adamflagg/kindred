import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { pb } from '../lib/pocketbase';

// Create a sync storage persister
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'bunking-query-cache',
  throttleTime: 1000,
});

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
        const httpError = error as { status?: number } | null;
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
        const httpError = error as { status?: number } | null;
        if (httpError?.status === 401) {
          pb.authStore.clear()
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`
          }
        }
      },
    },
  },
});

// Enable persistence to survive page refreshes
persistQueryClient({
  queryClient,
  persister,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

// Helper to manually invalidate cache (e.g., after sync)
export const invalidateCache = () => {
  queryClient.invalidateQueries();
};

// Helper to clear all cache including localStorage persistence
export const clearCache = () => {
  queryClient.clear();
  localStorage.removeItem('bunking-query-cache');
};

/**
 * Invalidate all sync-related data caches.
 * Call this after sync operations complete to ensure fresh data.
 * This invalidates Tier 1 (sync data) queries that may have changed.
 */
export const invalidateSyncData = () => {
  // Sessions
  queryClient.invalidateQueries({ queryKey: ['sessions'] });
  queryClient.invalidateQueries({ queryKey: ['all-sessions'] });
  queryClient.invalidateQueries({ queryKey: ['session'] });
  queryClient.invalidateQueries({ queryKey: ['session-stats'] });

  // Campers and persons
  queryClient.invalidateQueries({ queryKey: ['campers'] });
  queryClient.invalidateQueries({ queryKey: ['all-campers'] });
  queryClient.invalidateQueries({ queryKey: ['camper'] });
  queryClient.invalidateQueries({ queryKey: ['camper-history'] });

  // Historical data
  queryClient.invalidateQueries({ queryKey: ['historical-bunking'] });

  // Bunks and assignments
  queryClient.invalidateQueries({ queryKey: ['bunks'] });
  queryClient.invalidateQueries({ queryKey: ['bunk-assignments'] });

  // Bunk requests
  queryClient.invalidateQueries({ queryKey: ['bunk-requests'] });
  queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] });

  // Sync status
  queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
};