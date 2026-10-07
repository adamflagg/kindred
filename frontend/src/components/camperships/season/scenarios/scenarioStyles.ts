/**
 * Season › Scenarios' own marks (scenarios-v4.html). Same rules as kitStyles.ts: every raw amber or forest colour has
 * its `dark:` partner in the same string (scenarioStyles.test.ts); the type roles come from kit/csType.ts.
 */

/** A code chip's shape. It carries no size (Global Constraints: never a raw `text-*` size): it takes the size of the
 * CS_* role it sits in. Compare's heads wrap it in CS_SMALL (12px, the mock's chip), and its own ink overrides that
 * role's muted ink. */
const CHIP = 'inline-flex min-w-8 justify-center rounded px-1.5 font-bold'

/** A kept option's code in a Compare head: forest-700 fill. */
export const KEPT_CHIP = `${CHIP} bg-forest-700 text-white dark:bg-forest-600`
/** The Draft chip: a forest-200 tint. */
export const DRAFT_CHIP = `${CHIP} bg-forest-200 text-forest-900 dark:bg-forest-800 dark:text-forest-100`
/** The Rules and last season chips: muted, bordered. */
export const PLAIN_CHIP = `${CHIP} border-border text-muted-foreground border`
/** A money change that leaves more money (footnote 11, N9): green. The underline is an inset shadow, as the mock's
 * `.mvd`, not a border: a mark sits in the strip's flex lines, where a border would make each line 2px taller. */
export const CHANGE_MORE =
  'rounded-sm bg-forest-100 px-0.5 text-forest-700 shadow-[inset_0_-2px_0_var(--color-forest-500)] dark:bg-forest-900/70 dark:text-forest-300 dark:shadow-[inset_0_-2px_0_var(--color-forest-400)]'
/** A money change that leaves less: amber. */
export const CHANGE_LESS =
  'rounded-sm bg-amber-100/75 px-0.5 text-amber-900 shadow-[inset_0_-2px_0_var(--color-amber-500)] dark:bg-amber-900/55 dark:text-amber-100 dark:shadow-[inset_0_-2px_0_var(--color-amber-500)]'
/** A changed box (the Rules editor's `chg`). */
export const BOX_CHANGED = 'border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-900/30'
/** A box holding a bad figure. */
export const BOX_BAD = 'border-red-600 dark:border-red-400'
/** "was ‹old›" beside a changed box. */
export const WAS_INK = 'text-amber-700 dark:text-amber-300'
/** A value that differs from the rules in effect, in Compare (`.cv`): amber 700, a tint and an amber underline. */
export const SETTING_CHANGED =
  'rounded-[3px] border-b-2 border-amber-500 bg-amber-100/70 px-[3px] font-bold text-amber-700 dark:border-amber-500 dark:bg-amber-900/45 dark:text-amber-300'
/** A changed checkbox: a 2px amber outline. */
export const CHECK_CHANGED = 'outline-2 outline-offset-1 outline-amber-500 dark:outline-amber-400'
/** ▲ in Compare (owner line 685: the family counts keep forest/red); ▼ is NEGATIVE_INK. */
export const UP_INK = 'text-forest-600 dark:text-forest-300'
/** A locked card's tint. */
export const LOCKED_CARD = 'bg-muted/22'
/** A pool cell in the strip. */
export const POOL_CELL = 'border-border rounded-lg border bg-muted/14 px-2 py-1'
/** Fit's answer, under the tiers line. */
export const FIT_BOX = 'border-border rounded-lg border border-dashed px-2 py-1.5'
