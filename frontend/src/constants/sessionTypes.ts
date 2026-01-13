/**
 * Session type constants for the bunking application
 */

// Valid session types for summer camp views
export const VALID_SUMMER_SESSION_TYPES = ['main', 'embedded', 'ag'] as const;

// Primary session type (only main sessions appear in dropdowns)
export const PRIMARY_SESSION_TYPE = 'main' as const;

// Type for valid summer session types
export type ValidSummerSessionType = typeof VALID_SUMMER_SESSION_TYPES[number];

/**
 * Check if a session type is valid for summer views
 */
export function isValidSummerSession(sessionType: string): boolean {
  return VALID_SUMMER_SESSION_TYPES.includes(sessionType as ValidSummerSessionType);
}