// frontend/src/types/sourceField.ts
/**
 * SourceField wire-format string values for the bunk_requests.source_field column.
 *
 * Mirrors `bunking.sync.bunk_request_processor.shared.constants.SourceField`. The
 * Python↔TS drift guard test (#1217) pins this alignment in CI.
 *
 * Use these constants — never raw string literals — when comparing source_field.
 */
export const SourceField = {
  BUNK_REQUEST_FORM: 'bunk_request_form',
  STAFF_NOT_BUNK_WITH: 'staff_not_bunk_with',
  BUNKING_NOTES: 'bunking_notes',
  INTERNAL_NOTES: 'internal_notes',
  SOCIALIZE_WITH: 'socialize_with',
  MANUAL: 'manual',
} as const

export type SourceFieldValue = (typeof SourceField)[keyof typeof SourceField]
