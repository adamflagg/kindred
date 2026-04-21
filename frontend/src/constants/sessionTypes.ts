/**
 * Session type constants for the bunking application
 */

// Valid session types for summer camp views
export const VALID_SUMMER_SESSION_TYPES = ['main', 'embedded', 'ag', 'quest'] as const

// Primary session type (only main sessions appear in dropdowns)
export const PRIMARY_SESSION_TYPE = 'main' as const

// Type for valid summer session types
export type ValidSummerSessionType = (typeof VALID_SUMMER_SESSION_TYPES)[number]

/**
 * Check if a session type is valid for summer views
 */
export function isValidSummerSession(sessionType: string): boolean {
  return VALID_SUMMER_SESSION_TYPES.includes(sessionType as ValidSummerSessionType)
}

// ============================================================================
// Metrics view mode constants
// ============================================================================

/** Camp session types (main, embedded, ag) - excludes quest */
export const CAMP_SESSION_TYPES = ['main', 'embedded', 'ag'] as const

/** Quest session types only */
export const QUEST_SESSION_TYPES = ['quest'] as const

/** All session types (camp + quest) */
export const ALL_SESSION_TYPES = ['main', 'embedded', 'ag', 'quest'] as const

/** View mode for metrics: camp sessions, quest sessions, or all combined */
export type MetricsViewMode = 'sessions' | 'quests' | 'all'

/** All summer + teen program session types (admin/config views) */
export const ADMIN_SUMMER_SESSION_TYPES = [
  'main',
  'embedded',
  'ag',
  'quest',
  'scit',
  'tli',
] as const
