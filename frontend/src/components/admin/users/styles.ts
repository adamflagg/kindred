/**
 * Class strings the Users page shares across its tabs and drawers, so a chip,
 * tag or button looks the same wherever it appears (mock v15).
 */

/** A role name as a chip: the Users table's Roles column and "Granted by". */
export const ROLE_CHIP =
  'bg-primary/12 text-primary hover:bg-primary/20 rounded-md px-2 py-0.5 text-[12.5px] leading-[18px] font-medium whitespace-nowrap'

/** A permission no screen checks. One rose pill everywhere it shows. */
export const NOT_CHECKED_PILL =
  'inline-flex items-center rounded-md bg-rose-100 px-1.5 text-xs leading-[18px] font-medium whitespace-nowrap text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'

const CHANGE_TAG = 'rounded px-1.5 text-[10px] leading-4 font-bold tracking-[0.04em] uppercase'
/** "adding" / "new" beside a draft change. */
export const TAG_ADD = `${CHANGE_TAG} bg-emerald-600/15 text-emerald-700 dark:text-emerald-400`
/** "removing" / "removed": the same rose for every removal. */
export const TAG_REMOVE = `${CHANGE_TAG} bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300`

export const OK_TEXT = 'text-emerald-600 dark:text-emerald-400'
export const WARN_TEXT = 'text-rose-700 dark:text-rose-300'

const SMALL_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold disabled:cursor-default disabled:opacity-45'
export const BTN_PRIMARY_SM = `${SMALL_BTN} bg-primary text-primary-foreground`
export const BTN_GHOST_SM = `${SMALL_BTN} text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground`
/** Sized like New role; btn-primary alone is px-6 py-3. */
export const BTN_PRIMARY_MD = 'btn-primary gap-1.5 rounded-[10px] px-3.5 py-[7px] text-[13px]'

/**
 * A drawer section heading (mock `.dh`). These are h4s, and the unlayered
 * `styles/fonts.css` sets h3/h4 letter-spacing, so the tracking needs `!`.
 */
export const SECTION_HEAD =
  'text-muted-foreground mb-2 text-[11px] font-semibold !tracking-[0.06em] uppercase'
export const SECTION_COUNT = 'ml-1 font-medium opacity-70'
