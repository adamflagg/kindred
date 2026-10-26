import type { WaitlistMetrics } from '../../../types/metrics'

export interface WaitlistCompareView {
  /** Show the compare year's figures, columns and deltas. */
  comparable: boolean
  /** The one plain line shown instead of a comparison, or null. */
  line: string | null
}

/**
 * PM-8 A: a past waitlist can't be rebuilt for a day, so while registration is live the Waitlist tab
 * has no comparison (the server answers `prior_basis: 'unavailable'`). After the season it compares
 * with the compare year's final, as before.
 */
export function waitlistCompareView(
  compareYear: number | null,
  comparison: Pick<WaitlistMetrics, 'prior_basis'> | undefined
): WaitlistCompareView {
  if (compareYear === null) return { comparable: false, line: null }
  if (comparison?.prior_basis === 'unavailable') {
    return { comparable: false, line: "No comparison: a past waitlist can't be rebuilt for a day." }
  }
  return { comparable: true, line: null }
}
