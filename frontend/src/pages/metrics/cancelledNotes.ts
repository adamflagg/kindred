import type { DefinitionNote } from '../../components/camperships/kit/DefinitionNotes'

/**
 * Decision 11 (#3207): Analytics keeps two "cancelled" counts and labels both, with numbered
 * notes at the foot of the page, never hover text.
 *
 * - Overview and Trends count campers whose final status is Cancelled (decision 10). Trends uses
 *   it for every year, so it matches Overview.
 * - Registration › Cancellations counts Cancelled, Withdrawn and Dismissed, and splits them by
 *   the status a camper had before cancelling, which Kindred has recorded only since 2026.
 */
export const CANCELLED_FINAL_NOTE =
  'Cancelled: campers whose status in CampMinder is Cancelled now, each counted once. Withdrawn and dismissed campers are not included. Registration › Cancellations counts them too, so its total can be higher.'

/** Trends' rate, which divides by enrolled plus cancelled. */
export const CANCEL_RATE_NOTE = 'Cancel %: cancelled ÷ (enrolled + cancelled).'

export const CANCELLATIONS_TAB_NOTE =
  'Total Cancelled: campers whose status in CampMinder is Cancelled, Withdrawn or Dismissed now, each counted once, so it can be higher than Overview’s Total Cancelled. The status before cancelling and Re-enrolled come from status changes Kindred has recorded, which start in 2026.'

/** Decision 46: a swap has no time window. */
export const SWAP_NOTE =
  'Session Swaps: cancelled campers who are still enrolled in another session this summer, however long after cancelling they enrolled. True Departures: cancelled campers not enrolled in any session.'

export const OVERVIEW_NOTES: readonly DefinitionNote[] = [
  { n: 1, term: 'Cancelled', text: CANCELLED_FINAL_NOTE },
]

export const TRENDS_NOTES: readonly DefinitionNote[] = [
  { n: 1, term: 'Cancelled', text: CANCELLED_FINAL_NOTE },
  { n: 2, term: 'Cancel %', text: CANCEL_RATE_NOTE },
]

export const CANCELLATIONS_NOTES: readonly DefinitionNote[] = [
  { n: 1, term: 'Total Cancelled', text: CANCELLATIONS_TAB_NOTE },
  { n: 2, term: 'Session Swaps', text: SWAP_NOTE, alsoBold: ['True Departures'] },
]
