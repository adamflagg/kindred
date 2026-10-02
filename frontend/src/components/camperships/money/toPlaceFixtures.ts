/**
 * Money › To place fixtures (slice 3): an invented 2027 season in the shape of `ToPlaceResponse`.
 * Families and campers from tests/CLAUDE.md's set; every figure, date and id is invented. Each
 * group's count and total are what the server would send for its lines (the screen never sums).
 */
import type {
  ApiAidToPlace,
  ApiAidToPlaceCandidate,
  ApiAidToPlaceLine,
} from '../../../types/api-types'

export const EMMA_REQ = 'reqemma00000001'
export const SAMUEL_REQ = 'reqsamuel000002'
export const OLIVIA_REQ = 'reqolivia000003'
export const LIAM_REQ = 'reqliam00000004'
export const LIAM_QUEST_REQ = 'reqliamquest005'

function candidate(
  over: Partial<ApiAidToPlaceCandidate> &
    Pick<ApiAidToPlaceCandidate, 'request_id' | 'camper' | 'person_cm_id'>
): ApiAidToPlaceCandidate {
  return {
    household_cm_id: 1000001,
    family: 'Johnson',
    session_cm_id: 1000102,
    session: 'Session 2',
    not_yet_in_campminder: 0,
    cancelled: false,
    ...over,
  }
}

const EMMA = candidate({
  request_id: EMMA_REQ,
  camper: 'Emma Johnson',
  person_cm_id: 2000001,
  not_yet_in_campminder: 2200,
})
const SAMUEL = candidate({
  request_id: SAMUEL_REQ,
  camper: 'Samuel Johnson',
  person_cm_id: 2000005,
  not_yet_in_campminder: 1420,
})

/** Several requests: Kindred suggests a split, and it ticks Emma's Round 2. */
export const JOHNSON_SPLIT: ApiAidToPlaceLine = {
  transaction_cm_id: 3000001,
  household_cm_id: 1000001,
  family: 'Johnson',
  person_cm_id: 0,
  person: '',
  amount: 3620,
  unplaced: 3620,
  posted_on: '2027-05-14',
  description: 'Camp aid · Summer',
  reason: 'several',
  candidates: [EMMA, SAMUEL],
  suggestion: {
    parts: [
      { request_id: EMMA_REQ, amount: 2200 },
      { request_id: SAMUEL_REQ, amount: 1420 },
    ],
    evidence: [
      {
        kind: 'proportional',
        text: 'The line equals the two requests’ amounts not yet in CampMinder together.',
      },
    ],
    would_tick: [{ request_id: EMMA_REQ, round: 2, amount: 780 }],
    would_lock: 780,
    would_leave: [],
    would_not_tick: [],
  },
}

/** Several requests, one suggestion whose tick D152 withholds: the price moved after the posting. */
export const GARCIA_WITHHELD: ApiAidToPlaceLine = {
  transaction_cm_id: 3000002,
  household_cm_id: 1000002,
  family: 'Garcia',
  person_cm_id: 2000002,
  person: 'Liam Garcia',
  amount: 600,
  unplaced: 600,
  posted_on: '2027-04-03',
  description: 'Camp aid · Summer',
  reason: 'several',
  candidates: [
    candidate({
      request_id: LIAM_REQ,
      camper: 'Liam Garcia',
      person_cm_id: 2000002,
      household_cm_id: 1000002,
      family: 'Garcia',
      not_yet_in_campminder: 640,
    }),
    candidate({
      request_id: LIAM_QUEST_REQ,
      camper: 'Liam Garcia',
      person_cm_id: 2000002,
      household_cm_id: 1000002,
      family: 'Garcia',
      session_cm_id: 1000201,
      session: 'Quest',
    }),
  ],
  suggestion: {
    parts: [{ request_id: LIAM_REQ, amount: 600 }],
    evidence: [{ kind: 'person', text: 'The person on the line is Liam Garcia.' }],
    would_tick: [],
    would_lock: 0,
    would_leave: [],
    would_not_tick: [
      {
        transaction_cm_id: 3000002,
        request_id: LIAM_REQ,
        round: 2,
        posted_on: '2027-04-03',
        reasons: ['income corrected Apr 20'],
        why: "Round 2 was not ticked automatically: after CampMinder posted it on Apr 3, income corrected Apr 20. The nightly ledger sync leaves it too: tick it by hand. That locks the higher of its decided amount on Apr 3 (where Kindred can rebuild that day) and today's. Check it against what the family was offered first.",
      },
    ],
  },
}

/** One live request, an exact single match: a bulk confirm may take it (Decision 6). */
export const CHEN_EXACT: ApiAidToPlaceLine = {
  transaction_cm_id: 3000003,
  household_cm_id: 1000003,
  family: 'Chen',
  person_cm_id: 0,
  person: '',
  amount: 1500,
  unplaced: 1500,
  posted_on: '2027-05-20',
  description: 'Camp aid · Quest',
  reason: 'several',
  candidates: [
    candidate({
      request_id: OLIVIA_REQ,
      camper: 'Olivia Chen',
      person_cm_id: 2000003,
      household_cm_id: 1000003,
      family: 'Chen',
      session_cm_id: 1000201,
      session: 'Quest',
      not_yet_in_campminder: 1500,
    }),
  ],
  suggestion: {
    parts: [{ request_id: OLIVIA_REQ, amount: 1500 }],
    evidence: [
      { kind: 'amount', text: 'Exact amount: Olivia’s $1,500 not yet in CampMinder.' },
      { kind: 'only_request', text: 'The family’s one live request.' },
    ],
    would_tick: [{ request_id: OLIVIA_REQ, round: 2, amount: 1500 }],
    would_lock: 1500,
    would_leave: [],
    would_not_tick: [],
  },
}

/** No request behind it: nothing to confirm. */
export const SAM_NO_REQUEST: ApiAidToPlaceLine = {
  transaction_cm_id: 3000004,
  household_cm_id: 1000004,
  family: 'Sam',
  person_cm_id: 2000004,
  person: 'Riley Sam',
  amount: 900,
  unplaced: 900,
  posted_on: '2027-04-18',
  description: 'Camp aid · Summer',
  reason: 'no_request',
  candidates: [],
  suggestion: null,
}

/** The description names a program this camper isn't in. */
export const SAMUEL_MISMATCH: ApiAidToPlaceLine = {
  transaction_cm_id: 3000005,
  household_cm_id: 1000001,
  family: 'Johnson',
  person_cm_id: 2000005,
  person: 'Samuel Johnson',
  amount: 300,
  unplaced: 300,
  posted_on: '2027-06-01',
  description: 'Camp aid · Quest',
  reason: 'program_mismatch',
  candidates: [SAMUEL],
  suggestion: {
    parts: [{ request_id: SAMUEL_REQ, amount: 300 }],
    evidence: [{ kind: 'amount', text: 'Exact amount: Samuel’s Round 3 is $300.' }],
    would_tick: [{ request_id: SAMUEL_REQ, round: 3, amount: 300 }],
    would_lock: 300,
    would_leave: [],
    would_not_tick: [],
  },
}

/** Left at family level, with its note. */
export const GARCIA_LEFT: ApiAidToPlaceLine = {
  ...GARCIA_WITHHELD,
  transaction_cm_id: 3000006,
  person_cm_id: 0,
  person: '',
  amount: 120,
  unplaced: 120,
  posted_on: '2027-02-02',
  suggestion: null,
  left_note: 'A deposit credit keyed as aid',
}

/** Reclassified, waiting for tonight's ledger sync. */
export const SAM_RECLASSIFIED: ApiAidToPlaceLine = {
  ...SAM_NO_REQUEST,
  transaction_cm_id: 3000007,
  amount: 450,
  unplaced: 450,
  reclassified_to: 'Grantor C full-ride program',
}

export const TO_PLACE: ApiAidToPlace = {
  year: 2027,
  household_cm_id: null,
  open_count: 5,
  open_total: 6920,
  groups: [
    {
      reason: 'several',
      label: 'Several requests could take this line',
      count: 3,
      total: 5720,
      lines: [JOHNSON_SPLIT, GARCIA_WITHHELD, CHEN_EXACT],
    },
    {
      reason: 'no_request',
      label: 'No request behind this line',
      count: 1,
      total: 900,
      lines: [SAM_NO_REQUEST],
    },
    {
      reason: 'program_mismatch',
      label: "The description names a program this camper isn't in",
      count: 1,
      total: 300,
      lines: [SAMUEL_MISMATCH],
    },
  ],
  left: [GARCIA_LEFT],
  left_total: 120,
  reclassified: [],
  reclassified_total: 0,
  skipped: '',
}

/** A season before To place's first (2027): the server sends nothing, and says why. */
export const TO_PLACE_SKIPPED: ApiAidToPlace = {
  year: 2026,
  household_cm_id: null,
  open_count: 0,
  open_total: 0,
  groups: [],
  skipped: '2026 predates To place (the first ticked season is 2027)',
}
