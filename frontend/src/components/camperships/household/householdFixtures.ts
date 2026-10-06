/**
 * Fictional household pages for slice 1's tests (tests/CLAUDE.md's set; every figure invented).
 * Samuel Johnson stands in as a parent where a card lists adults, as the kit's fixtures do.
 */
import type {
  ApiAidApplication,
  ApiAidHouseholdCard,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidGridRow,
  ApiAidReceipt,
  ApiAidRequestOut,
} from '../../../types/api-types'
import { TRACE_CAPPED_BY_ASK } from '../kit/fixtures'
import { ROW_EMMA, ROW_SAMUEL } from '../requests/gridFixtures'

export function receiptOut(
  round: number,
  label: Partial<ApiAidReceipt['label']> = {}
): ApiAidReceipt {
  return {
    round,
    trace: [...TRACE_CAPPED_BY_ASK],
    label: {
      kind: 'live',
      season: 2027,
      rules_version: 1,
      locked_on: null,
      lock_source: null,
      ticked_by_name: null,
      decided_by_name: null,
      ...label,
    },
  }
}

export function householdCard(over: Partial<ApiAidHouseholdCard> = {}): ApiAidHouseholdCard {
  return {
    household_cm_id: 1000001,
    chip: 1,
    family_name: 'The Johnson Family',
    adults: ['Samuel Johnson'],
    phone: '555-0100',
    emails: ['test@example.com'],
    city: 'Riverside, CA',
    money: { decided: 3220, posted: 1800, in_campminder: 1590, states: [] },
    request_ids: ['reqemma00000001', 'reqsamuel000005'],
    ...over,
  }
}

export function householdRequest(
  row: ApiAidGridRow,
  over: Partial<ApiAidHouseholdRequest> = {}
): ApiAidHouseholdRequest {
  return {
    row,
    ask: null,
    payer_share_status: 'complete',
    shares: [
      {
        household_cm_id: row.household_cm_id,
        chip: 1,
        share_pct: 100,
        decided: row.total_decided,
        posted: row.total_posted,
        in_campminder: null,
        status: null,
      },
    ],
    receipts: [receiptOut(1)],
    ...over,
  }
}

export function householdPage(over: Partial<ApiAidHouseholdPage> = {}): ApiAidHouseholdPage {
  return {
    year: 2027,
    household_cm_id: 1000001,
    rules_version: 1,
    households: [householdCard()],
    totals: {
      cost: 13520,
      decided: 3220,
      grants: 1000,
      family_share: 9300,
      posted: 1800,
      states: [{ status: 'short', count: 1, gap: -210 }],
    },
    requests: [
      householdRequest(ROW_EMMA),
      householdRequest(ROW_SAMUEL, {
        receipts: [
          receiptOut(1, {
            kind: 'locked',
            locked_on: '2027-03-09',
            lock_source: 'tick',
            ticked_by_name: 'Test User',
          }),
        ],
      }),
    ],
    incomes: [
      {
        household_cm_id: 1000001,
        status: 'complete',
        form_people: [],
        answers: [
          {
            field: 'total_adjusted_income',
            synced: '84200.00',
            effective: '84200.00',
            corrected: false,
            changed_since_correction: false,
            history: [],
          },
          {
            field: 'num_children',
            synced: '2',
            effective: '3',
            corrected: true,
            changed_since_correction: false,
            history: [],
          },
        ],
        notes: { special_circumstances: 'Second parent lost work in March.' },
        flags: [],
      },
    ],
    grants: [
      {
        kind: 'ledger',
        transaction_cm_id: 1000302,
        commitment_id: '',
        household_cm_id: 1000001,
        family_name: 'The Johnson Family',
        person_cm_id: 1000002,
        camper_name: 'Emma Johnson',
        camper_basis: 'ledger',
        session_cm_id: 1000101,
        session_name: 'Session 2',
        program_family: 'summer',
        grantor_key: 'grantor_a',
        grantor_name: 'Grantor A',
        description: 'Outside grant',
        source_family: 'outside',
        funder_type: 'outside',
        amount: 1000,
        recorded_on: '2027-02-01',
        is_reversed: false,
        reversal_date: '',
        cancelled: false,
        counts: true,
        // The server's per-grant flag: counted outside money on a live request, so the band takes it.
        in_band: true,
        fulfils_commitment_id: '',
        requests: [{ request_id: 'reqemma00000001', amount: 1000 }],
      },
    ],
    expected: [
      {
        household_cm_id: 1000001,
        family_name: 'The Johnson Family',
        kind: 'synagogue',
        person_cm_ids: [1000002],
        camper_names: ['Emma Johnson'],
      },
    ],
    postings: [
      {
        transaction_cm_id: 1000301,
        household_cm_id: 1000001,
        amount: 1800,
        source_key: 'camp_aid',
        effective_source_key: 'camp_aid',
        source_family: 'camp_aid',
        funder_type: 'camp',
        counts_toward_budget: true,
        post_date: '2027-03-09',
        is_reversed: true,
        reversal_date: '2027-03-20',
        transaction_note: '',
        attribution_level: 'person',
        attribution_method: 'session',
        program_family: 'summer',
        attributed_person_cm_id: 1000010,
        attributed_session_cm_id: 1000102,
        candidate_program_families: [],
        open_flags: [],
        accepted_flags: {},
      },
      {
        transaction_cm_id: 1000303,
        household_cm_id: 1000001,
        amount: 1590,
        source_key: 'camp_aid',
        effective_source_key: 'camp_aid',
        source_family: 'camp_aid',
        funder_type: 'camp',
        counts_toward_budget: true,
        post_date: '2027-03-20',
        is_reversed: false,
        reversal_date: '',
        transaction_note: '',
        attribution_level: 'person',
        attribution_method: 'session',
        program_family: 'summer',
        attributed_person_cm_id: 1000010,
        attributed_session_cm_id: 1000102,
        candidate_program_families: [],
        open_flags: [],
        accepted_flags: {},
      },
    ],
    links: [],
    history: [
      {
        at: '2027-01-05T17:00:00Z',
        action: 'create',
        entity: 'aid_requests',
        entity_id: 'reqemma00000001',
        request_id: 'reqemma00000001',
        actor: 'system:intake',
        reason: '',
        operation_id: 'op0000000000001',
        before: null,
        after: null,
      },
      {
        at: '2027-03-09T18:00:00Z',
        action: 'tick_posted',
        entity: 'aid_decision_events',
        entity_id: 'reqsamuel000005:1',
        request_id: 'reqsamuel000005',
        actor: 'test@example.com',
        reason: 'Entered in CampMinder',
        operation_id: 'op0000000000002',
        before: null,
        after: null,
      },
    ],
    ...over,
  }
}

/** Emma's request split half and half with the Garcia household, which has no camper of its own here. */
export const SPLIT_PAGE: ApiAidHouseholdPage = householdPage({
  households: [
    householdCard({
      money: { decided: 710, posted: null, in_campminder: null, states: [] },
      request_ids: ['reqemma00000001'],
    }),
    householdCard({
      household_cm_id: 1000003,
      chip: 2,
      family_name: 'The Garcia Family',
      adults: [],
      phone: '',
      emails: [],
      city: '',
      money: { decided: 710, posted: null, in_campminder: null, states: [] },
      request_ids: ['reqemma00000001'],
    }),
  ],
  requests: [
    householdRequest(ROW_EMMA, {
      shares: [
        {
          household_cm_id: 1000001,
          chip: 1,
          share_pct: 50,
          decided: 710,
          posted: null,
          in_campminder: null,
          status: null,
        },
        {
          household_cm_id: 1000003,
          chip: 2,
          share_pct: 50,
          decided: 710,
          posted: null,
          in_campminder: null,
          status: null,
        },
      ],
    }),
  ],
})

/**
 * SPLIT_PAGE as #3025's server names its households (owner, 2026-10-05): each card's `label` is its
 * adults' names alone, and two that read the same each carry a muted `label_tiebreak` (the city when
 * that tells them apart, else "#" and the CampMinder household id).
 */
export const TIED_PAGE: ApiAidHouseholdPage = {
  ...SPLIT_PAGE,
  households: SPLIT_PAGE.households.map((card) =>
    card.household_cm_id === 1000001
      ? { ...card, label: 'Pat Garcia', label_tiebreak: 'Riverside, CA' }
      : { ...card, label: 'Pat Garcia', label_tiebreak: '#1000003' }
  ),
}

/** An intake request as the application read carries it: flags, headcounts and duplicates. */
export function requestOut(over: Partial<ApiAidRequestOut> = {}): ApiAidRequestOut {
  return {
    id: 'reqemma00000001',
    household_cm_id: 1000001,
    person_cm_id: 1000002,
    session_cm_id: 0,
    program_key: 'summer',
    program_option_text: '',
    session_resolution: 'unmatched',
    status: 'unmatched_session',
    duplicate_of: '',
    ask: {
      field: 'ask',
      synced: '2000.00',
      effective: '2000.00',
      corrected: false,
      changed_since_correction: false,
      history: [],
    },
    headcount_non_infant: 0,
    headcount_infant: 0,
    headcount_source: '',
    flags: [{ code: 'unmatched_session', detail: { candidates: [1000101, 1000199] } }],
    ...over,
  }
}

export function applicationOut(over: Partial<ApiAidApplication> = {}): ApiAidApplication {
  return {
    year: 2027,
    household_cm_id: 1000001,
    status: 'complete',
    member_person_cm_ids: [1000002, 1000010],
    answers: [],
    notes: {},
    requests: [requestOut()],
    flags: [],
    ...over,
  }
}
