/**
 * A request's stage, derived from its rounds (§6.1; SP10a: stage is derived, not stored). Each round
 * has one state; the words are the server's (slice 1 Decision 6).
 */
import type { ApiAidGridRow, ApiAidRound } from '../../../types/api-types'
import type { PillTone } from '../kit/kitStyles'

/**
 * The server's ROUND_STATUS_LABELS (api/services/financial_aid_queues.py), word for word. The grid
 * row carries only the code. Both are held to tests/fixtures/camperships_frontend_mirrors.json (a
 * pytest and stage.test.ts), so a change on either side fails on its own PR.
 */
export const ROUND_STATUS_WORDS = {
  held: 'On hold',
  not_decided: 'Not decided',
  needs_offer: 'Needs an offer',
  pending_approval: 'Pending approval',
  refused: 'Refused by finance',
  posted: 'Posted',
  not_rebuilt: 'Not rebuilt for that date',
} as const satisfies Record<ApiAidRound['status'], string>

export function roundOf(row: Pick<ApiAidGridRow, 'rounds'>, n: number): ApiAidRound | undefined {
  return row.rounds.find((r) => r.round === n)
}

export function latestRound(row: Pick<ApiAidGridRow, 'rounds'>): ApiAidRound | undefined {
  return row.rounds.reduce<ApiAidRound | undefined>(
    (latest, r) => (latest === undefined || r.round > latest.round ? r : latest),
    undefined
  )
}

export interface Stage {
  readonly text: string
  readonly tone: PillTone
}

const ROUND_TONE: Readonly<Record<number, PillTone>> = { 1: 'muted', 2: 'sky', 3: 'purple' }

/** §4.5: on hold red, accepted emerald, Round 2 sky, Round 3 purple; Round 1 is plain. */
export function roundTone(round: ApiAidRound): PillTone {
  if (round.status === 'held') return 'red'
  if (round.status === 'posted' && round.accepted) return 'emerald'
  return ROUND_TONE[round.round] ?? 'muted'
}

/** The grid's Stage: "R2 · Needs an offer", "R1 · Accepted", or "Cancelled". */
export function requestStage(row: Pick<ApiAidGridRow, 'rounds' | 'cancellation'>): Stage | null {
  if (row.cancellation) return { text: 'Cancelled', tone: 'stone' }
  const round = latestRound(row)
  if (round === undefined) return null
  const words =
    round.status === 'posted' && round.accepted ? 'Accepted' : ROUND_STATUS_WORDS[round.status]
  return { text: `R${String(round.round)} · ${words}`, tone: roundTone(round) }
}
