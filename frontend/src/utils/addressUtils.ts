/**
 * Shared address utilities for displaying location
 *
 * Phase 2: Uses discrete columns (address_city, address_state) instead of JSON parsing.
 */

/**
 * Format city/state into a display string.
 * Uses discrete columns directly - no JSON parsing needed.
 */
export function getLocationDisplay(
  city: string | null | undefined,
  state: string | null | undefined
): string | null {
  const trimmedCity = city?.trim() ?? ''
  const trimmedState = state?.trim() ?? ''

  if (!trimmedCity && !trimmedState) {
    return null
  }

  return [trimmedCity, trimmedState].filter(Boolean).join(', ')
}
