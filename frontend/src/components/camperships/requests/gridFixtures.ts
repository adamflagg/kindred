/**
 * Fictional Requests grid rows for slice 1's tests. Names, ids and households are tests/CLAUDE.md's
 * set; every figure is invented. Request ids are 15 characters, as the server's are.
 */
import type { ApiAidConfirmation, ApiAidGridRow, ApiAidRound } from '../../../types/api-types'

export function roundOut(
  round: 1 | 2 | 3,
  status: ApiAidRound['status'],
  over: Partial<ApiAidRound> = {}
): ApiAidRound {
  return {
    round,
    status,
    ask: null,
    asked_on: null,
    decided: null,
    posted: null,
    posted_on: null,
    accepted: false,
    pending_approval: null,
    would_change_by: null,
    counts_toward_budget: true,
    rules_version: 1,
    lock_source: null,
    clawed_back: false,
    ...over,
  }
}

export function confirmationOut(over: Partial<ApiAidConfirmation> = {}): ApiAidConfirmation {
  return {
    status: 'confirmed',
    locked: 0,
    in_campminder: 0,
    gap: 0,
    on: '2027-03-10',
    reconciled: true,
    family_unplaced: 0,
    shares: [],
    ...over,
  }
}

export function gridRow(over: Partial<ApiAidGridRow> = {}): ApiAidGridRow {
  return {
    request_id: 'reqemma00000001',
    household_cm_id: 1000001,
    family_name: 'The Johnson Family',
    person_cm_id: 1000002,
    camper_name: 'Emma Johnson',
    session_cm_id: 1000101,
    session_name: 'Session 2',
    program_key: 'summer',
    pool: 'pool_a',
    request_status: 'active',
    tier: 4,
    cost: 6760,
    rounds: [roundOut(1, 'needs_offer', { ask: 2000, decided: 1420 })],
    total_decided: 1420,
    total_posted: null,
    holds: [],
    released_holds: [],
    notes: [],
    confirmation: null,
    cancellation: null,
    to_reverse: false,
    todos: [],
    queues: ['needs_offer'],
    ...over,
  }
}

/** Round 1 decided, not posted: Needs an offer. */
export const ROW_EMMA = gridRow()

/** Round 1 posted Mar 9, not accepted; CampMinder shows $210 less. */
export const ROW_SAMUEL = gridRow({
  request_id: 'reqsamuel000005',
  person_cm_id: 1000010,
  camper_name: 'Samuel Johnson',
  session_cm_id: 1000102,
  session_name: 'Session 3',
  rounds: [
    roundOut(1, 'posted', { ask: 2500, decided: 1800, posted: 1800, posted_on: '2027-03-09' }),
  ],
  total_decided: 1800,
  total_posted: 1800,
  confirmation: confirmationOut({
    status: 'short',
    locked: 1800,
    in_campminder: 1590,
    gap: -210,
    on: null,
    reconciled: false,
  }),
  queues: ['waiting_on_family', 'not_reconciled'],
})

/** On hold: placeholder income. */
export const ROW_LIAM = gridRow({
  request_id: 'reqliam00000002',
  household_cm_id: 1000003,
  family_name: 'The Garcia Family',
  person_cm_id: 1000004,
  camper_name: 'Liam Garcia',
  tier: null,
  rounds: [roundOut(1, 'held', { ask: 1800 })],
  total_decided: null,
  holds: [
    {
      code: 'placeholder_income',
      severity: 'hold',
      message:
        'Income was entered as $1, so no tier can be set. Call for the real figure and enter it as a correction.',
    },
  ],
  queues: ['holds'],
})

/** Round 1 posted and accepted; an appeal keyed, Round 2 needs an offer. Quest, pool B. */
export const ROW_OLIVIA = gridRow({
  request_id: 'reqolivia000003',
  household_cm_id: 1000005,
  family_name: 'The Chen Family',
  person_cm_id: 1000006,
  camper_name: 'Olivia Chen',
  session_cm_id: 1000201,
  session_name: 'Quest 1',
  program_key: 'quest',
  pool: 'pool_b',
  tier: 4,
  rounds: [
    roundOut(1, 'posted', {
      ask: 2000,
      decided: 1420,
      posted: 1420,
      posted_on: '2027-03-09',
      accepted: true,
    }),
    roundOut(2, 'needs_offer', { ask: 1200, asked_on: '2027-04-09', decided: 780 }),
  ],
  total_decided: 2200,
  total_posted: 1420,
  confirmation: confirmationOut({ locked: 1420, in_campminder: 1420 }),
  queues: ['needs_offer', 'appeals'],
})

/** CampMinder cancelled the enrollment with aid still live, and no reason recorded. */
export const ROW_RILEY = gridRow({
  request_id: 'reqriley0000004',
  household_cm_id: 1000007,
  family_name: 'The Sam Family',
  person_cm_id: 1000008,
  camper_name: 'Riley Sam',
  session_cm_id: 1000100,
  session_name: 'Session 1',
  rounds: [
    roundOut(1, 'posted', { ask: 1500, decided: 1500, posted: 1500, posted_on: '2027-03-09' }),
  ],
  total_decided: 1500,
  total_posted: 1500,
  confirmation: confirmationOut({ locked: 1500, in_campminder: 1500 }),
  cancellation: { by: 'campminder', on: '2027-06-02', reason: null, note: '' },
  to_reverse: true,
  todos: [{ code: 'cancel_reason_missing', message: 'Cancelled: give a reason' }],
  queues: ['to_reverse', 'cancel_reason'],
})

export const GRID_ROWS: readonly ApiAidGridRow[] = [
  ROW_EMMA,
  ROW_SAMUEL,
  ROW_LIAM,
  ROW_OLIVIA,
  ROW_RILEY,
]
