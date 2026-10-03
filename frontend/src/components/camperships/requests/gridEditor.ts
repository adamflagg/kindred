import type { ApiAidGridRow } from '../../../types/api-types'
import { roundOf } from './stage'

/**
 * The request statuses the server takes an ask for (LIVE_STATUSES in
 * api/services/financial_aid_decisions_service.py), held to the shared fixture by both sides.
 */
export const LIVE_REQUEST_STATUSES: readonly string[] = ['active', 'unmatched_session']

export type AppealTarget =
  | { readonly kind: 'appeal'; readonly initialAmount: number | null }
  | { readonly kind: 'none'; readonly why: string }

/**
 * Whether the grid's editor row can key this row's appeal (Decision 13). When it can't, the row's
 * `appeal_refusal` says why: the write's own sentence, refused the same ways in the same order
 * (`appeal_refusal` in api/services/financial_aid_decisions_service.py, #2997). The frontend keeps
 * no copy of those rules or words.
 */
export function appealTarget(row: ApiAidGridRow): AppealTarget {
  if (row.appeal_refusal) return { kind: 'none', why: row.appeal_refusal }
  return { kind: 'appeal', initialAmount: roundOf(row, 2)?.ask ?? null }
}
