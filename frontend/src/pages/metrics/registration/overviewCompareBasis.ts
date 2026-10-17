import type { DefinitionNote } from '../../../components/camperships/kit/DefinitionNotes'
import type { RegistrationMetrics } from '../../../types/metrics'
import { PRIORITY_DAY_NOTE } from '../../../utils/priorityDay'

/** What Overview says about the year it compares with (decision 7, PR 7). */
export interface CompareBasis {
  label: 'vs same point' | 'vs final'
  /** One sentence under the label, ending where the page's numbered notes are marked. */
  text: string
  /** The page's numbered notes for this comparison, numbered from `firstNote`. */
  notes: DefinitionNote[]
  /** On the priority date itself the compare waits a day (ruling 9): deltas read "updates tomorrow". */
  pending: boolean
  /** A same-point read has no waitlist: a past waitlist cannot be rebuilt. */
  waitlistComparable: boolean
}

type BasisFields = Pick<
  RegistrationMetrics,
  'prior_basis' | 'day_offset' | 'prior_day_offset' | 'as_of_date' | 'total_waitlisted'
>

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "2025-03-02" → "Mar 2, 2025". A calendar date, so it is formatted in UTC and never shifts a day. */
export function formatDay(isoDate: string): string {
  return LONG_DATE.format(new Date(`${isoDate}T00:00:00Z`))
}

/**
 * Decision 7: while registration is live, Overview compares with the same registration day last
 * year (registered by then and not cancelled by then), and with last year's final after. The
 * server picks the basis (`same_point_of`); this says which in words, with numbered notes.
 */
export function describeCompareBasis(
  compareYear: number | null,
  comparison: BasisFields | undefined,
  /** The first note number free on the page: these notes follow the page's own (decision 11). */
  firstNote = 1
): CompareBasis | null {
  if (compareYear === null || !comparison?.prior_basis) return null

  if (comparison.prior_basis === 'final' || !comparison.as_of_date) {
    return {
      label: 'vs final',
      text: `Compared with ${compareYear}'s final numbers.`,
      notes: [],
      pending: false,
      waitlistComparable: comparison.total_waitlisted != null,
    }
  }

  const day = formatDay(comparison.as_of_date)
  const notes: DefinitionNote[] = [
    {
      n: firstNote,
      text: `${compareYear} is rebuilt from each camper's registration date: campers registered by ${day} and not cancelled by then. This season's numbers are today's. A waitlist can't be rebuilt, so Total Waitlisted has no comparison.`,
    },
  ]
  const throughNextDay =
    comparison.prior_day_offset != null &&
    comparison.day_offset != null &&
    comparison.prior_day_offset !== comparison.day_offset
  if (throughNextDay) notes.push({ n: firstNote + 1, text: PRIORITY_DAY_NOTE })

  return {
    label: 'vs same point',
    text: `Compared with ${compareYear} as it stood on ${day}, the same registration day as today.`,
    notes,
    pending: comparison.day_offset === 0,
    waitlistComparable: false,
  }
}
