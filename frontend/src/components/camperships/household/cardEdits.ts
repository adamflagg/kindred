import type { ApiAidGridRow } from '../../../types/api-types'
import { appealTarget, isLiveRequest } from '../requests/gridEditor'
import { roundOf } from '../requests/stage'

export type CardEditKind = 'appeal' | 'round3_ask' | 'round3_amount'

export const CARD_EDIT_LABEL: Readonly<Record<CardEditKind, string>> = {
  appeal: 'Edit the Appeal…',
  round3_ask: 'Round 3 Ask…',
  round3_amount: 'Round 3 Amount…',
}

/**
 * The money edits a request card offers (§4.6; Decisions 13, 23): the appeal where the grid's editor
 * row would offer it; Round 3's ask, then its amount, once Round 1 is posted and until Round 3 is.
 * A cancelled request takes no new ask or amount, whoever cancelled it (B35, owner ruling 10-05:
 * CampMinder's as well as the dashboard's); only its reason, and Reopen… where that applies.
 */
export function cardEdits(row: ApiAidGridRow): CardEditKind[] {
  // The server's `_live`: a withdrawn or duplicate request takes no new asks or amounts.
  if (!isLiveRequest(row)) return []
  if (row.cancellation) return []
  const edits: CardEditKind[] = []
  if (appealTarget(row).kind === 'appeal') edits.push('appeal')
  const r3 = roundOf(row, 3)
  if (roundOf(row, 1)?.status === 'posted' && r3?.status !== 'posted') {
    edits.push('round3_ask')
    if ((r3?.ask ?? null) !== null) edits.push('round3_amount')
  }
  return edits
}
