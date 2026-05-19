/**
 * Single source of truth for source field value→label mappings (#808).
 *
 * Used by ProcessRequestOptions (checkboxes) and useProcessRequests (toast description).
 */
export const SOURCE_FIELD_OPTIONS = [
  { value: 'bunk_request_form', label: 'Bunk With' },
  { value: 'staff_not_bunk_with', label: 'Not Bunk With' },
  { value: 'bunking_notes', label: 'Bunking Notes' },
  { value: 'internal_notes', label: 'Internal Notes' },
  { value: 'socialize_with', label: 'Socialize With' },
] as const

/** Derives a Record<string, string> lookup from SOURCE_FIELD_OPTIONS. */
export function buildFieldLabelMap(): Record<string, string> {
  return Object.fromEntries(SOURCE_FIELD_OPTIONS.map((o) => [o.value, o.label]))
}
