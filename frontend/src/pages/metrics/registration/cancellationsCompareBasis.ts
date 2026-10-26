import type { CancellationMetrics } from '../../../types/metrics'
import { describeSamePointBasis, type CompareBasis } from './overviewCompareBasis'

export interface CancellationsCompareBasis extends CompareBasis {
  /**
   * The status before cancelling and Re-enrolled come from recorded status changes. A same-point read
   * whose history can't rebuild them sends them as null: those cards and splits show no comparison.
   */
  priorStatusComparable: boolean
}

type Fields = Pick<
  CancellationMetrics,
  'prior_basis' | 'day_offset' | 'prior_day_offset' | 'as_of_date' | 'was_enrolled'
>

/**
 * PM-8 A: Cancellations compares with the same registration day last year while registration is live,
 * and with last year's final after, in Overview's grammar. The server picks the basis (`same_point_of`).
 */
export function describeCancellationsCompareBasis(
  compareYear: number | null,
  comparison: Fields | undefined,
  firstNote = 1
): CancellationsCompareBasis | null {
  const basis = describeSamePointBasis(
    compareYear,
    comparison && { ...comparison, total_waitlisted: null },
    firstNote,
    (year, day) =>
      `${String(year)} is rebuilt from each record's dates: cancellations dated by ${day}, and whether the camper was enrolled in another session then. This season's numbers are today's.`
  )
  if (basis === null || compareYear === null) return null
  const priorStatusComparable = comparison?.was_enrolled != null
  if (priorStatusComparable) return { ...basis, priorStatusComparable }
  return {
    ...basis,
    priorStatusComparable,
    notes: [
      ...basis.notes,
      {
        n: firstNote + basis.notes.length,
        text: `Was Enrolled, Was Waitlisted, Was Applied, Other Prior and Re-enrolled have no comparison: they come from status changes Kindred has recorded, which don't cover ${String(compareYear)}'s whole registration year. ${String(compareYear)}'s charts show those campers as Unknown.`,
      },
    ],
  }
}
