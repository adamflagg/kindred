/**
 * Human-readable display labels for source field names.
 *
 * This is the SINGLE source of truth for source field display labels.
 * Handles both:
 * - DB/SourceField wire values ("bunk_request_form", "staff_not_bunk_with") —
 *   used by PipelineBatchList and other views that read source_field from the DB.
 * - Validator stats keys ("share_bunk_with", "do_not_share_with") — emitted
 *   by bunking_validator.py and shown in the post-check modal.
 */
const SOURCE_FIELD_LABELS: Record<string, string> = {
  // Validator stats keys (bunking_validator.py _SOURCEFIELD_TO_STATS_KEY)
  share_bunk_with: 'Bunk Request Form',
  do_not_share_with: 'Do NOT Share Bunk With',
  // DB wire values (SourceField constants)
  bunk_request_form: 'Bunk Request Form',
  staff_not_bunk_with: 'Do NOT Share Bunk With',
  // Shared keys (same in both contexts)
  bunking_notes: 'Bunking Notes',
  internal_notes: 'Internal Notes',
  socialize_with: 'Social With Checkbox',
}

export function formatSourceField(field: string): string {
  return SOURCE_FIELD_LABELS[field] ?? field
}
