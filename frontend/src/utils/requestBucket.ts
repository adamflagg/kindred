/**
 * Frontend mirror of bunking/satisfaction/bucket.py — but answers a different
 * question. The Python is_material_parent_request asks "is this specifically
 * MATERIAL_PARENT?" (for solver hard-constraint gating). This helper asks
 * "should this row be visible to staff?" — so missing/unknown source_field
 * returns true (fail-open) to avoid silently hiding real issues.
 *
 * Do not refactor the Python helper to use this semantic — they are
 * intentionally different.
 */
export type RequestSourceField =
  | 'bunk_request_form'
  | 'socialize_with'
  | 'staff_not_bunk_with'
  | 'bunking_notes'
  | 'internal_notes'

export const IMMATERIAL_SOURCE_FIELDS: ReadonlySet<RequestSourceField> = new Set(['socialize_with'])

export function isMaterialRequest(req: { source_field?: string | null | undefined }): boolean {
  if (!req.source_field) return true // fail-open
  return !IMMATERIAL_SOURCE_FIELDS.has(req.source_field as RequestSourceField)
}
