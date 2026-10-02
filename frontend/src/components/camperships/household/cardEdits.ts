import type { ApiAidGridRow } from '../../../types/api-types'
import { appealTarget, LIVE_REQUEST_STATUSES } from '../requests/gridEditor'
import { roundOf } from '../requests/stage'

export type CardEditKind = 'appeal' | 'round3_ask' | 'round3_amount'

export const CARD_EDIT_LABEL: Readonly<Record<CardEditKind, string>> = {
  appeal: 'Edit the appeal…',
  round3_ask: 'Round 3 ask…',
  round3_amount: 'Round 3 amount…',
}

/**
 * The money edits a request card offers (§4.6; Decisions 13, 23): the appeal where the grid's editor
 * row would offer it; Round 3's ask, then its amount, once Round 1 is posted and until Round 3 is.
 * A Kindred cancellation takes no new decision (the server's rule).
 */
export function cardEdits(row: ApiAidGridRow): CardEditKind[] {
  // The server's `_live`: a withdrawn or duplicate request takes no new asks or amounts.
  if (row.request_status !== null && !LIVE_REQUEST_STATUSES.includes(row.request_status)) return []
  if (row.cancellation?.by === 'kindred') return []
  const edits: CardEditKind[] = []
  if (appealTarget(row).kind === 'appeal') edits.push('appeal')
  const r3 = roundOf(row, 3)
  if (roundOf(row, 1)?.status === 'posted' && r3?.status !== 'posted') {
    edits.push('round3_ask')
    if ((r3?.ask ?? null) !== null) edits.push('round3_amount')
  }
  return edits
}
