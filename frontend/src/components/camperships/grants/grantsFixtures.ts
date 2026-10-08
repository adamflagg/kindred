/**
 * Grants fixtures (slice 3): an invented 2027 season in the shape of `GrantsResponse`. Campers from
 * tests/CLAUDE.md's set; funders "Grantor A–E"; every figure, date and id invented. Each is a shape
 * the server sends: a row that doesn't count (`counts: false`) carries no `requests`, since the
 * register empties them (`api/services/financial_aid_grants_register.py`, `build_rows`), and a priced
 * read names the round each share offsets (`RequestShareOut.offsets`).
 */
import type { ApiAidGrantRow, ApiAidGrants } from '../../../types/api-types'

export function grantRow(
  over: Partial<ApiAidGrantRow> & Pick<ApiAidGrantRow, 'transaction_cm_id'>
): ApiAidGrantRow {
  return {
    kind: 'ledger',
    commitment_id: '',
    household_cm_id: 1000001,
    family_name: 'Johnson',
    label: '',
    label_tiebreak: '',
    person_cm_id: 2000001,
    camper_name: 'Emma Johnson',
    camper_basis: 'ledger',
    session_cm_id: 1000102,
    session_name: 'Session 2',
    program_family: 'summer',
    program_label: 'Summer Camp',
    grantor_key: 'grantor_a',
    grantor_name: 'Grantor A',
    description: 'Grantor A grant',
    source_family: 'other_outside',
    funder_type: 'outside',
    amount: 700,
    recorded_on: '2027-03-12',
    is_reversed: false,
    reversal_date: '',
    cancelled: false,
    counts: true,
    fulfils_commitment_id: '',
    requests: [
      {
        request_id: 'reqemma00000001',
        amount: 700,
        offsets: 'round',
        round: 1,
        round_amount: 1420,
      },
    ],
    committed_on: '',
    commitment_note: '',
    ...over,
  }
}

/** A grant in CampMinder on Emma's request: Round 1 is $1,420 now. */
export const EMMA_GRANT = grantRow({ transaction_cm_id: 4000001 })
/** A household-level line in a household that applied: it needs a camper (D126). */
export const GARCIA_HOUSEHOLD = grantRow({
  transaction_cm_id: 4000002,
  household_cm_id: 1000002,
  family_name: 'Garcia',
  label: 'Pat Garcia',
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none',
  session_cm_id: 0,
  session_name: '',
  program_family: '',
  program_label: '',
  grantor_key: 'grantor_b',
  grantor_name: 'Grantor B',
  description: 'Grantor B grant',
  amount: 1500,
  recorded_on: '2027-04-03',
  counts: false,
  requests: [],
})
/** An open commitment, not yet in CampMinder (D55), with its stored note and date (#2975). */
export const RILEY_COMMITMENT = grantRow({
  kind: 'commitment',
  transaction_cm_id: 0,
  commitment_id: 'cmtriley0000001',
  household_cm_id: 1000004,
  family_name: 'Sam',
  person_cm_id: 2000004,
  camper_name: 'Riley Sam',
  camper_basis: 'commitment',
  session_cm_id: 1000103,
  session_name: 'Session 3',
  grantor_key: 'grantor_c',
  grantor_name: 'Grantor C',
  description: '',
  source_family: '',
  amount: 6200,
  recorded_on: '2027-04-02',
  committed_on: '2027-04-02',
  commitment_note: 'Letter of Apr 2',
  requests: [
    { request_id: 'reqriley0000006', amount: 6200, offsets: 'round', round: 1, round_amount: 0 },
  ],
})
/** A reversed line: struck through, out of every total (D54, D74). */
export const OLIVIA_REVERSED = grantRow({
  transaction_cm_id: 4000004,
  household_cm_id: 1000003,
  family_name: 'Chen',
  person_cm_id: 2000003,
  camper_name: 'Olivia Chen',
  session_name: 'Quest',
  amount: 1000,
  is_reversed: true,
  reversal_date: '2027-04-01',
  counts: false,
  requests: [],
})
/** A commitment whose camper cancelled: it shows, and doesn't count while the enrollment is cancelled. */
export const SAMUEL_CANCELLED = grantRow({
  kind: 'commitment',
  transaction_cm_id: 0,
  commitment_id: 'cmtsamuel000001',
  person_cm_id: 2000005,
  camper_name: 'Samuel Johnson',
  camper_basis: 'commitment',
  grantor_key: 'grantor_b',
  grantor_name: 'Grantor B',
  description: '',
  source_family: '',
  amount: 1500,
  recorded_on: '2027-04-08',
  committed_on: '2027-04-08',
  cancelled: true,
  counts: false,
  requests: [],
})
/**
 * ⚠ A posted grant for a cancelled camper: it COUNTS until CampMinder reverses it (a ledger line's
 * `counts` is "not reversed, and a camper or a household target"; cancellation plays no part).
 */
export const SAMUEL_POSTED_CANCELLED = grantRow({
  transaction_cm_id: 4000009,
  person_cm_id: 2000005,
  camper_name: 'Samuel Johnson',
  amount: 1500,
  recorded_on: '2027-03-20',
  cancelled: true,
  requests: [
    { request_id: 'reqsamuel000002', amount: 1500, offsets: 'round', round: 1, round_amount: 2700 },
  ],
})
/**
 * A household that never applied (Liam's second home, 1000006): tied to its one camper by rule
 * (D142); it counts with no request. Its own household, not Garcia's 1000002, which applied: the
 * server ties a line by rule only in a household that never applied (R5-5).
 */
export const LIAM_SOLE_CAMPER = grantRow({
  transaction_cm_id: 4000006,
  household_cm_id: 1000006,
  family_name: 'Garcia',
  label: 'Sam Garcia',
  person_cm_id: 2000002,
  camper_name: 'Liam Garcia',
  camper_basis: 'sole_camper',
  grantor_key: 'grantor_d',
  grantor_name: 'Grantor D',
  description: 'Grantor D grant',
  amount: 900,
  requests: [],
})
/**
 * R5-2: a household-level line in a household that never applied and has two campers, so it stays
 * at household level (D126/D142). The server doesn't count it (`counts` false: no camper, not a
 * household program) and leaves it out of `needs_camper` (applied households only). The spec and
 * grants-v2.html mark it "didn't apply"; it sits outside the counted total, which the footnote says.
 * Not in `GRANTS.grants` (the Register tests' counts stay); the model and filter tests add it.
 */
export const NEVER_APPLIED_HOUSEHOLD = grantRow({
  transaction_cm_id: 4000012,
  household_cm_id: 1000009,
  family_name: 'Johnson',
  label: 'Alex Johnson',
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none',
  session_cm_id: 0,
  session_name: '',
  program_family: '',
  program_label: '',
  grantor_key: 'grantor_d',
  grantor_name: 'Grantor D',
  description: 'Grantor D grant',
  amount: 900,
  recorded_on: '2027-04-09',
  counts: false,
  requests: [],
})
/** An unmapped description's line: no grantor yet (D160); known after Round 1 posted. */
export const OLIVIA_AFTER_OFFER = grantRow({
  transaction_cm_id: 4000007,
  household_cm_id: 1000003,
  family_name: 'Chen',
  person_cm_id: 2000003,
  camper_name: 'Olivia Chen',
  session_name: 'Quest',
  grantor_key: '',
  grantor_name: '',
  description: 'Grantor E grant 2027',
  amount: 900,
  recorded_on: '2027-05-02',
  requests: [{ request_id: 'reqolivia000003', amount: 900, offsets: 'after_offer' }],
})

export const GRANTS: ApiAidGrants = {
  year: 2027,
  grants: [
    EMMA_GRANT,
    GARCIA_HOUSEHOLD,
    RILEY_COMMITMENT,
    OLIVIA_REVERSED,
    SAMUEL_CANCELLED,
    LIAM_SOLE_CAMPER,
    OLIVIA_AFTER_OFFER,
    SAMUEL_POSTED_CANCELLED,
  ],
  needs_camper: [
    {
      grant: GARCIA_HOUSEHOLD,
      household_applied: true,
      suggestion: {
        person_cm_id: 2000002,
        camper_name: 'Liam Garcia',
        session_cm_id: 1000102,
        program_family: 'summer',
        basis: 'attribution',
        method: 'household_single_camper',
        commitment_id: '',
        amount_matches: false,
      },
      candidates: [{ person_cm_id: 2000002, name: 'Liam Garcia' }],
    },
  ],
  unmapped: [
    {
      source_id: 'srcgrantore0005',
      description_key: 'keygrantore0005',
      description: 'Grantor E grant 2027',
      lines: 4,
      amount: 3600,
    },
  ],
  waiting: [
    { grant: RILEY_COMMITMENT, days_waiting: 18, reason: 'not_posted', transaction_cm_id: 0 },
    { grant: SAMUEL_CANCELLED, days_waiting: 12, reason: 'camper_cancelled', transaction_cm_id: 0 },
  ],
  expected: [
    {
      household_cm_id: 1000003,
      family_name: 'Chen',
      kind: 'synagogue',
      person_cm_ids: [2000003],
      camper_names: ['Olivia Chen'],
      display_name: null,
    },
  ],
}
