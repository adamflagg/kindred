/**
 * Rounds & budget's six notes (final design, kit §12: six at most, always shown). The server's registry numbers them
 * by key (`SURFACES["season-rounds-budget"]`); several figures share one note, as the mock's footnote marks do:
 * 1 Allocated and Share, 2 Committed and Accepted, 3 Posted and Not yet confirmed, 4 Needs an offer and Pending
 * approval, 5 Remaining, 6 Below the line (Shown, not counted, and Demand still to come).
 */
export type RoundsFigure =
  | 'allocated'
  | 'share'
  | 'committed'
  | 'accepted'
  | 'posted'
  | 'unconfirmed'
  | 'needs_offer'
  | 'pending_approval'
  | 'remaining'
  | 'below_the_line'
  | 'demand'

export const ROUNDS_NOTE_KEY: Readonly<Record<RoundsFigure, string>> = {
  allocated: 'rounds_allocated',
  share: 'rounds_allocated',
  committed: 'rounds_committed',
  accepted: 'rounds_committed',
  posted: 'rounds_posted',
  unconfirmed: 'rounds_posted',
  needs_offer: 'rounds_needs_offer',
  pending_approval: 'rounds_needs_offer',
  remaining: 'rounds_remaining',
  below_the_line: 'rounds_below_the_line',
  demand: 'rounds_below_the_line',
}

/** A figure's footnote number on this surface (null until the registry has loaded). */
export function roundsNote(
  numberOf: (key: string) => number | null,
  figure: RoundsFigure
): number | null {
  return numberOf(ROUNDS_NOTE_KEY[figure])
}

/** The second term each note's words name, bold as the mock sets them (notes 2, 3 and 4). */
export const ROUNDS_NOTE_ALSO_BOLD: readonly string[] = [
  'Accepted',
  'Not yet confirmed:',
  'Pending approval:',
]
