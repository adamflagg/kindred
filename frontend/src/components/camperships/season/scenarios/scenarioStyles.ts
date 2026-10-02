/**
 * Season › Scenarios' own marks (scenarios-v2.html): the amber draft, the forest option codes and
 * the amber names of changed settings. Same rules as kitStyles.ts: every raw palette colour has its
 * `dark:` partner in the same string (scenarioStyles.test.ts), and `text-xs` is the floor.
 */

const CHIP = 'inline-flex min-w-8 justify-center rounded px-1.5 text-xs font-bold'

/** The Draft chip: amber with deep forest ink, as the mock draws it. */
export const DRAFT_CHIP = `${CHIP} bg-amber-500 text-forest-900 dark:bg-amber-400 dark:text-forest-950`
/** Your draft's row: a dashed amber box. */
export const DRAFT_ROW =
  'rounded-lg border border-dashed border-amber-400 bg-amber-50 px-2 py-1.5 text-sm dark:border-amber-600 dark:bg-amber-900/20'
/** A starting point's code (A, B): solid forest. */
export const START_CHIP = `${CHIP} bg-forest-700 text-white dark:bg-forest-600`
/** A variant's code (A1, B2): light forest. */
export const VARIANT_CHIP = `${CHIP} bg-forest-100 text-forest-900 dark:bg-forest-800 dark:text-forest-100`
/** A setting that differs from where the draft came from ("Amber = differs from B"). */
export const CHANGED_NAME = 'font-semibold text-amber-700 dark:text-amber-400'
/** The strip: amber-tinted, as the draft's own figures. */
export const STRIP_CARD =
  'shadow-lodge-sm flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20'
