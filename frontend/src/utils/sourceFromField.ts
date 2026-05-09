/**
 * Derive RequestSource from a source_field value.
 *
 * Mirrors the Python `source_from_field` in
 * `bunking/sync/bunk_request_processor/core/models.py`.
 *
 * This is the authoritative 6→2 mapping that makes RequestSource a
 * deterministic projection of source_field rather than an independent axis.
 * See issue #1142 for context. 'manual' is the admin-UI input channel
 * (CreateRequestModal) — admin entry is staff entry by definition.
 */

type RequestSource = 'family' | 'staff'

const SOURCE_FIELD_MAP: Readonly<Record<string, RequestSource>> = {
  bunk_with: 'family',
  socialize_with: 'family',
  not_bunk_with: 'staff',
  bunking_notes: 'staff',
  internal_notes: 'staff',
  manual: 'staff',
}

/**
 * Derive RequestSource from a source_field value.
 *
 * Returns null when the input is empty, null, undefined, or unknown so a
 * single bad row can't crash the surrounding render — callers fall back to
 * `request.source` or another safe default.
 *
 * The Python counterpart `source_from_field` raises on unknown input because
 * it has writer/validator callers that want strict failure. TS only has
 * render-path callers, so the safe variant is the only one exposed.
 */
export function safeSourceFromField(sourceField: string | null | undefined): RequestSource | null {
  if (!sourceField) return null
  return SOURCE_FIELD_MAP[sourceField] ?? null
}
