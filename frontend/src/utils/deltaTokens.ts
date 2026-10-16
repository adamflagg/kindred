/**
 * The app-wide change colours (#3207 PR 8; owner 2026-10-14, "kit centralization opp"; rulings #16–#18,
 * 2026-10-15). One set for every change figure in Analytics:
 *
 *   good     forest, the house palette (the kit's WeekCard ▲). Replaces Overview's emerald.
 *   bad      the kit's red (Camperships' NEGATIVE_INK).
 *   neutral  grey: a change that is neither good nor bad news (the waitlist, decision 16; Applied,
 *            Incomplete; New Campers, ruling #17), and "no change".
 *
 * Camperships keeps its amber ▼ on money posted (ruling #18, POOL_NEGATIVE_INK): a stated per-module
 * divergence, not a fourth token. Colour only: these never change what a number says.
 */
export const DELTA_INK = {
  good: 'text-forest-700 dark:text-forest-300',
  bad: 'text-red-700 dark:text-red-400',
  neutral: 'text-muted-foreground',
} as const

export type DeltaTone = keyof typeof DELTA_INK

/** How a figure's rise reads: more is better, more is worse, or neither. */
export type DeltaKind = 'up-good' | 'up-bad' | 'neutral'

/** The tone of a change of `delta` in a figure of `kind`. */
export function deltaTone(delta: number, kind: DeltaKind): DeltaTone {
  if (kind === 'neutral' || delta === 0) return 'neutral'
  return delta > 0 === (kind === 'up-good') ? 'good' : 'bad'
}

/** The text classes for a change of `delta` in a figure of `kind`. */
export function deltaInk(delta: number, kind: DeltaKind): string {
  return DELTA_INK[deltaTone(delta, kind)]
}
