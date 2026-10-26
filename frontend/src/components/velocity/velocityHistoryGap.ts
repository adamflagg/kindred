/**
 * Cancellation Velocity split by gender: the words for what the gender lines cannot show. A cancellation with no
 * status history row (already cancelled when the dashboard first saw it) has no date, and on the Gender field's
 * boys and girls lines a camper with another or no answer has no line, so both are in the season's total and on
 * no line. The identity lines hold every answer, so only the date cause applies there. N comes from the server
 * (`gender_history_gaps`), never re-derived here.
 */

import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'
import type { GenderHistoryGap } from '../../types/velocity'
import type { GenderBasis } from '../../types/velocity'
import { formatCount } from '../../utils/numberFormat'

export const NO_HISTORY_TEXT =
  'No day-by-day cancellation history for this season: the dashboard first saw every cancellation already made.'

export function gapText(unseen: number, basis: GenderBasis): string {
  const causes = basis === 'field' ? 'no date or no boy/girl answer' : 'no date'
  return (
    'The gender lines count each cancellation on the day the dashboard first saw it. ' +
    `${formatCount(unseen)} cancellations this season have ${causes}, so they're in the total but not in these lines.`
  )
}

/** A season's words are named ("2026: …") only when more than one season is drawn. */
function worded(gap: GenderHistoryGap, text: string, named: boolean): string {
  return named ? `${gap.year}: ${text}` : text
}

export interface HistoryGapNotes {
  /** Numbered notes for seasons with history and a gap above 0, numbered from `firstN`. */
  readonly notes: DefinitionNote[]
  /** Plain lines for seasons with no history at all. */
  readonly noHistory: string[]
}

export function historyGapNotes(
  gaps: readonly GenderHistoryGap[] | undefined,
  firstN: number,
  basis: GenderBasis
): HistoryGapNotes {
  const seasons = gaps ?? []
  // Name a season only when more than one season has words to show.
  const named = seasons.filter((g) => g.no_history || g.unseen_count > 0).length > 1
  const notes: DefinitionNote[] = []
  const noHistory: string[] = []
  for (const gap of seasons) {
    if (gap.no_history) {
      noHistory.push(worded(gap, NO_HISTORY_TEXT, named))
    } else if (gap.unseen_count > 0) {
      notes.push({
        n: firstN + notes.length,
        text: worded(gap, gapText(gap.unseen_count, basis), named),
      })
    }
  }
  return { notes, noHistory }
}
