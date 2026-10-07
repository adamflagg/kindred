/**
 * Camperships' visual grammar (spec §2.1, §4; D19): the compact admin dialect of
 * lodgingStyles.ts and auditStyles.ts, extended rather than a third one. Every raw palette
 * colour is paired with its `dark:` partner (aidStyles.test.ts holds that line); `text-xs`
 * is the floor.
 */

/** A negative figure (D74): a red-700 minus, the same weight as its neighbours. */
export const NEGATIVE_INK = 'text-red-700 dark:text-red-400'

/** A pool's negative Remaining (D74 amended, owner 10-06): amber, "over its share". Only the season's total is red. */
export const POOL_NEGATIVE_INK = 'text-amber-700 dark:text-amber-300'
