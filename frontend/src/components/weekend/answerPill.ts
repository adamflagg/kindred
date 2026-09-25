/**
 * The weekend panels' pill grammar and its yes/no tones, first drawn by
 * `SharePreferenceChip` and shared so another yes/no answer reads as that
 * chip's sibling rather than a restyle (kindred#2759: the adult guest's
 * Jotform housing answers). A `.ts` module, not an export of the chip's
 * `.tsx`, so that file keeps exporting only components (fast refresh).
 */
export const ANSWER_PILL_CLASS =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold'

export const ANSWER_PILL_TONE = {
  yes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  no: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
} as const
