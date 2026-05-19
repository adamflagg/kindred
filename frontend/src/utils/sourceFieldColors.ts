/** Shared source field color classes for badges (#682). */

const SOURCE_FIELD_COLORS: Record<string, string> = {
  bunk_request_form: 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400',
  staff_not_bunk_with: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  bunking_notes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  internal_notes: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400',
  socialize_with: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
}

const DEFAULT_CLASSES = 'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400'

/** Get Tailwind classes for a source field badge. */
export function getSourceFieldClasses(field: string): string {
  return SOURCE_FIELD_COLORS[field] ?? DEFAULT_CLASSES
}
