import { CS_BAND_WARN, CS_OK_BG, CS_OK_INK } from '../../kit/csType'
import { RG_TH_GROUP_MID } from '../rules/gridStyles'

/**
 * Season › Scenarios' own marks (scenarios-v4.html). Same rules as kitStyles.ts: every raw amber or forest colour has
 * its `dark:` partner in the same string (scenarioStyles.test.ts); the type roles come from kit/csType.ts.
 */

/** A money change that leaves more money (footnote 11, N9): green. The underline is an inset shadow, as the mock's
 * `.mvd`, not a border: a mark sits in the strip's flex lines, where a border would make each line 2px taller. */
export const CHANGE_MORE =
  'rounded-sm bg-forest-100 px-0.5 text-forest-700 shadow-[inset_0_-2px_0_var(--color-forest-500)] dark:bg-forest-900/70 dark:text-forest-300 dark:shadow-[inset_0_-2px_0_var(--color-forest-400)]'
/** A money change that leaves less: amber. */
export const CHANGE_LESS =
  'rounded-sm bg-amber-100/75 px-0.5 text-amber-900 shadow-[inset_0_-2px_0_var(--color-amber-500)] dark:bg-amber-900/55 dark:text-amber-100 dark:shadow-[inset_0_-2px_0_var(--color-amber-500)]'
/** A changed box (the kit's `.cf-input.was`): an amber border and a soft amber ring; its old value rides in its title. */
export const BOX_CHANGED =
  'border-amber-500 dark:border-amber-500 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-amber-400)_25%,transparent)]'
/** A box holding a bad figure. */
export const BOX_BAD = 'border-red-600 dark:border-red-400'
/** A value that differs from the rules in effect, in Compare (`.cv`): amber 700, a tint and an amber underline. */
export const SETTING_CHANGED =
  'rounded-[3px] border-b-2 border-amber-500 bg-amber-100/70 px-[3px] font-bold text-amber-700 dark:border-amber-500 dark:bg-amber-900/45 dark:text-amber-300'
/** A changed checkbox: a 2px amber outline. */
export const CHECK_CHANGED = 'outline-2 outline-offset-1 outline-amber-500 dark:outline-amber-400'
/** ▲ in Compare: forest. ▼ is POOL_NEGATIVE_INK (amber): the 10-09 mock beats the 10-06 forest/red ruling (owner Q10,
 * 2026-10-09). */
export const UP_INK = 'text-forest-600 dark:text-forest-300'
/** Fit's answer, one line in a box as wide as the card (the mock's `.cf-donebox` / `.cf-warnbox`): forest when the
 * shift uses the budget, amber when it can't or the draft moved. */
const FIT_LINE = 'flex flex-nowrap items-center gap-2.5 rounded-lg border px-2.5 py-[3px]'
export const FIT_DONE = `${FIT_LINE} border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] ${CS_OK_BG} ${CS_OK_INK}`
export const FIT_WARN = `${FIT_LINE} border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200 ${CS_BAND_WARN}`
/** A Sandbox card: the Rules card's shell (radius 10, padding 7px 12px 10px; the mock's `.cf-rcard`). */
export const CARD_SHELL =
  'bg-card border-border shadow-lodge-sm rounded-[10px] border px-3 pt-[7px] pb-2.5 text-[13.5px] leading-normal'
/** A group header over a block of the Sandbox grids (scenarios-4): the Rules grid's own, in foreground ink, as the mock. */
export const GROUP_HEAD = RG_TH_GROUP_MID.replace('text-muted-foreground', 'text-foreground')
