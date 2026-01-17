/**
 * Centralized query keys for consistent caching
 *
 * Always use these factory functions for query keys to ensure:
 * 1. Type-safe cache invalidation
 * 2. Consistent key structure across components
 * 3. Proper cache sharing between related queries
 */
export const queryKeys = {
  // Sessions (Tier 1 - sync data)
  sessions: (year: number) => ['sessions', year] as const,
  allSessions: (year: number) => ['all-sessions', year] as const,
  session: (id: string) => ['session', id] as const,

  // Campers (Tier 1 - sync data)
  allCampers: () => ['all-campers'] as const,
  camper: (id: string) => ['camper', id] as const,
  campersForSession: (sessionId: string, agSessions: string[], year?: number) =>
    year
      ? (['campers', sessionId, agSessions.sort(), year] as const)
      : (['campers', sessionId, agSessions.sort()] as const),

  // Bunks (Tier 1 - sync data)
  bunksForSession: (sessionId: string, agSessions: string[]) =>
    ['bunks', sessionId, agSessions.sort()] as const,

  // Historical data (Tier 1 - sync data)
  historicalBunking: (personCmId: number, year: number) =>
    ['historical-bunking', personCmId, year] as const,
  camperHistory: (personId: string) => ['camper-history', personId] as const,

  // Statistics (Tier 1 - sync data)
  sessionStats: (sessionId: string) => ['session-stats', sessionId] as const,

  // Scenarios (Tier 2 - user data)
  savedScenarios: (sessionCmId: number, year?: number) =>
    year
      ? (['saved-scenarios', sessionCmId, year] as const)
      : (['saved-scenarios', sessionCmId] as const),
  scenario: (id: string) => ['scenario', id] as const,

  // Bunk Requests (Tier 2 - user data)
  bunkRequests: (sessionId: string, year: number) =>
    ['bunk-requests', sessionId, year] as const,

  // Locked Groups (Tier 2 - user data)
  lockedGroups: (scenarioId: string, sessionId: string, year: number) =>
    ['locked-groups', scenarioId, sessionId, year] as const,

  // Sync Status (Tier 2 - frequently updated)
  syncStatus: () => ['sync-status'] as const,
  syncStatusForService: (service: string) => ['sync-status', service] as const,

  // Admin/Config (Tier 2 - user data)
  adminSettings: () => ['admin-settings'] as const,
  solverConfig: () => ['solver-config'] as const,

  // Debug (Tier 2 - frequently updated during testing)
  parseAnalysis: (filters?: { sessionCmId?: number | undefined; sourceField?: string | undefined }) =>
    filters
      ? (['parse-analysis', filters.sessionCmId, filters.sourceField] as const)
      : (['parse-analysis'] as const),
  parseAnalysisDetail: (id: string) => ['parse-analysis', id] as const,
  originalRequests: (year: number, filters?: { sessionCmId?: number | undefined; sourceField?: string | undefined }) =>
    filters
      ? (['original-requests', year, filters.sessionCmId, filters.sourceField] as const)
      : (['original-requests', year] as const),

  // Prompts (Tier 2 - editable config files)
  prompts: () => ['prompts'] as const,
  prompt: (name: string) => ['prompts', name] as const,
};

/**
 * 2-Tier Caching Model
 *
 * Tier 1: Sync data (read-only, long cache)
 * - Data synced from CampMinder that rarely changes during a session
 * - Safe to cache for extended periods
 * - Examples: sessions, campers, bunks, historical data
 *
 * Tier 2: User data (short cache, refetch on focus)
 * - Data that users actively edit or that changes frequently
 * - Must stay fresh to prevent stale reads
 * - Examples: bunk_requests, scenarios, locked_groups, sync_status
 */

/**
 * Tier 1: Sync data options - use for CampMinder-synced data
 *
 * Long cache because this data only changes via explicit sync operations.
 * No refetch on window focus to prevent unnecessary API calls.
 */
export const syncDataOptions = {
  staleTime: 60 * 60 * 1000, // 1 hour
  gcTime: 24 * 60 * 60 * 1000, // 24 hours
  refetchOnWindowFocus: false,
} as const;

/**
 * Tier 2: User data options - use for user-editable data
 *
 * Short cache because users may edit in multiple tabs or
 * other systems may modify the data.
 * Refetch on window focus to catch external changes.
 */
export const userDataOptions = {
  staleTime: 30 * 1000, // 30 seconds
  gcTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true,
} as const;

// Legacy aliases for backward compatibility
export const heavyQueryOptions = syncDataOptions;
export const realtimeQueryOptions = userDataOptions;