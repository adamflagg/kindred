/**
 * A request's stage (§6.1; SP10a: stage is derived, not stored): the server derives it (#2996) and
 * sends it on the row; the words are the server's (slice 1 Decision 6).
 */
import type { ApiAidGridRow, ApiAidRound, ApiAidRowStage } from '../../../types/api-types'
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

/** §4.5's tone for the server's stage code: on hold red, accepted emerald, cancelled stone, else the round's. */
function stageTone(stage: ApiAidRowStage): PillTone {
  if (stage.code === 'held') return 'red'
  if (stage.code === 'accepted') return 'emerald'
  if (stage.code === 'cancelled') return 'stone'
  return stage.round === null ? 'muted' : (ROUND_TONE[stage.round] ?? 'muted')
}

/**
 * The Stage ("R2 · Needs an offer", "R1 · Accepted", "Cancelled"): the server's `stage` (#2996), its
 * label drawn as sent and its code choosing the tone. The server derives it once for the grid and
 * the household page (a C1 round, in CampMinder in full but not yet ticked, reads Posted).
 */
export function requestStage(row: Pick<ApiAidGridRow, 'stage'>): Stage | null {
  const stage = row.stage
  return stage ? { text: stage.label, tone: stageTone(stage) } : null
}
