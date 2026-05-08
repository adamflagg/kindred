/**
 * Derive RequestSource from a source_field value.
 *
 * Mirrors the Python `source_from_field` in
 * `bunking/sync/bunk_request_processor/core/models.py`.
 *
 * This is the authoritative 5→2 mapping that makes RequestSource a
 * deterministic projection of source_field rather than an independent axis.
 * See issue #1142 for context.
 */

type RequestSource = 'family' | 'staff'

const SOURCE_FIELD_MAP: Readonly<Record<string, RequestSource>> = {
  bunk_with: 'family',
  socialize_with: 'family',
  not_bunk_with: 'staff',
  bunking_notes: 'staff',
  internal_notes: 'staff',
}

/**
 * Derive RequestSource from a source_field string.
 *
 * @param sourceField One of the 5 canonical source_field values.
 * @returns 'family' for parent-visible fields (bunk_with, socialize_with).
 *          'staff'  for staff-written fields (not_bunk_with, bunking_notes,
 *          internal_notes).
 * @throws Error if sourceField is not one of the 5 known values.
 */
export function sourceFromField(sourceField: string): RequestSource {
  const result = SOURCE_FIELD_MAP[sourceField]
  if (result === undefined) {
    throw new Error(`unknown source_field: ${JSON.stringify(sourceField)}`)
  }
  return result
}

/**
 * Best-effort variant: returns null instead of throwing when the input is
 * empty, null, undefined, or unknown. Use in render paths where a single bad
 * row shouldn't crash the surrounding component — caller falls back to
 * `request.source` or another safe default.
 */
export function safeSourceFromField(sourceField: string | null | undefined): RequestSource | null {
  if (!sourceField) return null
  return SOURCE_FIELD_MAP[sourceField] ?? null
}
