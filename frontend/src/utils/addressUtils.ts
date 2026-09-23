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

/** The subset of a person record `personLocation` reads. */
export interface LocationSource {
  normalized_city?: string | null
  address_city?: string | null
  address_state?: string | null
}

/**
 * A person's display-ready location.
 *
 * `normalized_city` is set by the geo-normalization sync as a COMPLETE "City,
 * ST" label (pocketbase/sync/family_camp_roster.go:
 * rosterStateSuffix/rosterCleanCity — 2,232 of 2,246 2026 values end in
 * ", ST"). When it is present it already IS the whole location, and
 * `address_state` must NOT be appended to it again — doing so is what
 * produced "San Carlos, CA, CA". `address_city` + `address_state` are
 * composed via `getLocationDisplay` only when there is no `normalized_city`
 * to use; `getLocationDisplay` itself is unchanged and knows nothing about
 * this rule.
 */
export function personLocation(person: LocationSource): string | null {
  const normalized = person.normalized_city?.trim() ?? ''
  if (normalized.length > 0) return normalized
  return getLocationDisplay(person.address_city, person.address_state)
}
