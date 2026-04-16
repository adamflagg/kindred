/**
 * Human-readable display labels for source field V2 names.
 *
 * This is the SINGLE source of truth for source field display labels.
 * V2 internal names (bunk_with, not_bunk_with, etc.) are the canonical
 * values stored in the database. This function converts them to
 * user-facing labels for display only.
 */
const SOURCE_FIELD_LABELS: Record<string, string> = {
  bunk_with: 'Bunk Request Form',
  not_bunk_with: 'Do NOT Share Bunk With',
  bunking_notes: 'Bunking Notes',
  internal_notes: 'Internal Notes',
  socialize_with: 'Social With Checkbox',
}

export function formatSourceField(field: string): string {
  return SOURCE_FIELD_LABELS[field] ?? field
}
