import type { ApiAidGridRow } from '../../../types/api-types'
import { roundOf } from './stage'

export type AppealTarget =
  | { readonly kind: 'appeal'; readonly initialAmount: number | null }
  | { readonly kind: 'none'; readonly why: string }

/**
 * Whether the grid's editor row can key this row's appeal (Decision 13). When it can't, the
 * sentence is the server's own (`_ask_refusal` and CANCELLED_IN_KINDRED in
 * api/services/financial_aid_decisions_service.py; tests/fixtures/camperships_frontend_mirrors.json
 * holds both sides to it), so the row says what the write would.
 */
export function appealTarget(row: ApiAidGridRow): AppealTarget {
  if (row.cancellation?.by === 'kindred') {
    return { kind: 'none', why: 'Cancelled in Kindred: reopen it first' }
  }
  const r1 = roundOf(row, 1)
  const r2 = roundOf(row, 2)
  if (r2?.status === 'posted')
    return { kind: 'none', why: "Round 2 is posted; its ask can't change" }
  if (r1?.status !== 'posted') {
    return {
      kind: 'none',
      why: 'An appeal answers a posted offer: tick Round 1 Posted first, or correct the Round 1 ask',
    }
  }
  if (roundOf(row, 3)?.status === 'posted') {
    return {
      kind: 'none',
      why: "Round 3 is posted and builds on Round 2: its ask can't change now",
    }
  }
  return { kind: 'appeal', initialAmount: r2?.ask ?? null }
}
