/**
 * Form intake fixtures in the mock's shapes (form-intake mock, season 2027 and 2026). Fictional names, generic ids.
 */
import type {
  AidOnNoRequestResponse,
  BecameOut,
  FormIntakeResponse,
  FormIntakeRowOut,
  IntakeSessionOut,
} from './intakeTypes'

export const S1 = 1000101
export const S2 = 1000102
export const S3 = 1000103
export const S4 = 1000104
export const T1 = 1000105
export const T2 = 1000106
export const TLI = 1000107
export const TWR = 1000108
export const BM2 = 1000109
export const FC2 = 1000110
export const WFC = 1000111

export const SESSIONS: IntakeSessionOut[] = [
  { session_cm_id: S1, name: 'Session 1', session_type: 'main', program_key: 'summer' },
  { session_cm_id: S2, name: 'Session 2', session_type: 'main', program_key: 'summer' },
  { session_cm_id: S3, name: 'Session 3', session_type: 'main', program_key: 'summer' },
  { session_cm_id: S4, name: 'Session 4', session_type: 'main', program_key: 'summer' },
  { session_cm_id: T1, name: 'Taste of Camp 1', session_type: 'embedded', program_key: 'summer' },
  { session_cm_id: T2, name: 'Taste of Camp 2', session_type: 'embedded', program_key: 'summer' },
  {
    session_cm_id: TLI,
    name: 'Teen Leadership Institute',
    session_type: 'teen',
    program_key: 'summer',
  },
  { session_cm_id: TWR, name: 'Teen Winter Retreat', session_type: 'teen', program_key: 'twr' },
  {
    session_cm_id: BM2,
    name: 'B*Mitzvah Program Year 2 - San Francisco',
    session_type: 'bmitzvah',
    program_key: 'tbm',
  },
  {
    session_cm_id: FC2,
    name: 'Family Camp 2: Fall Weekend',
    session_type: 'family',
    program_key: 'family_camp',
  },
  {
    session_cm_id: WFC,
    name: 'Winter Family Camp',
    session_type: 'family',
    program_key: 'family_camp',
  },
]

const became = (over: Partial<BecameOut>): BecameOut => ({
  request_id: 'req000000000001',
  program_key: 'summer',
  session_cm_id: S1,
  candidate_session_cm_ids: [],
  status: 'active',
  origin: 'form',
  ask: 1000,
  why: null,
  addition_id: '',
  added_by: '',
  added_at: '',
  added_reason: '',
  reviewed: null,
  reviewed_by: '',
  reviewed_at: '',
  posted_rounds: [],
  round1_posted: null,
  ...over,
})
export { became }

const row = (over: Partial<FormIntakeRowOut> & { key: string }): FormIntakeRowOut => ({
  household_cm_id: 1000001,
  household_label: 'Mia & Noah Johnson',
  household_tiebreak: '',
  person_cm_id: 1000011,
  camper_name: 'Emma Johnson',
  filed: true,
  registration_only: false,
  answers: [],
  registration_ask: null,
  enrolled_session_cm_ids: [],
  became: [],
  campminder_aid: [],
  why_not: null,
  gap_sessions: [],
  can_add: false,
  needs_look: false,
  look_reasons: [],
  ...over,
})
export { row as intakeRow }

/** Emma: TLI from the form, a $290 registration ask with the TWR enrollment, TWR held by no request. */
export const EMMA = row({
  key: '1000001:1000011',
  answers: [{ program_key: 'summer', option_text: 'TLI', ask: 4000, named_session_cm_id: TLI }],
  registration_ask: { amount: 290, on: null },
  enrolled_session_cm_ids: [TLI, TWR],
  became: [became({ request_id: 'reqemmatli00001', session_cm_id: TLI, ask: 4000 })],
  why_not: 'enrolled_no_request',
  gap_sessions: [{ session_cm_id: TWR, program_key: 'twr', campminder_amount: null }],
  can_add: true,
  needs_look: true,
  look_reasons: ['enrolled_no_request'],
})

/** Olivia: one request, its session unclear between two enrollments. */
export const OLIVIA = row({
  key: '1000003:1000031',
  household_cm_id: 1000003,
  household_label: 'Wei & Lin Chen',
  person_cm_id: 1000031,
  camper_name: 'Olivia Chen',
  answers: [{ program_key: 'summer', option_text: 'Session 2 or Taste 2', ask: 3500 }],
  enrolled_session_cm_ids: [S2, T2],
  became: [
    became({
      request_id: 'reqolivia000001',
      session_cm_id: 0,
      candidate_session_cm_ids: [S2, T2],
      status: 'session_unclear',
      ask: 3500,
    }),
  ],
  needs_look: true,
  look_reasons: ['session_unclear'],
})

/** Riley: registration only, $2,500 asked, CampMinder posted $2,258 on Session 3 with no request. */
export const RILEY = row({
  key: '1000004:1000041',
  household_cm_id: 1000004,
  household_label: 'Jordan & Casey Sam',
  person_cm_id: 1000041,
  camper_name: 'Riley Sam',
  filed: false,
  registration_only: true,
  registration_ask: { amount: 2500, on: '2026-11-12' },
  enrolled_session_cm_ids: [S3],
  campminder_aid: [{ session_cm_id: S3, amount: 2258, posted_on: '2027-02-20', on_request: false }],
  why_not: 'registration_only',
  gap_sessions: [{ session_cm_id: S3, program_key: 'summer', campminder_amount: 2258 }],
  can_add: true,
  needs_look: true,
  look_reasons: ['campminder_aid'],
})

/** Ava: a form request and a rule-made one from a registration ask, not yet reviewed. */
export const AVA = row({
  key: '1000006:1000061',
  household_cm_id: 1000006,
  household_label: 'Daniel Chen-Okafor',
  person_cm_id: 1000061,
  camper_name: 'Ava Chen-Okafor',
  answers: [
    { program_key: 'summer', option_text: 'Session 1', ask: 2600, named_session_cm_id: S1 },
  ],
  registration_ask: { amount: 1200, on: null },
  enrolled_session_cm_ids: [S1, BM2],
  became: [
    became({ request_id: 'reqava000000001', session_cm_id: S1, ask: 2600 }),
    became({
      request_id: 'reqava000000002',
      program_key: 'tbm',
      session_cm_id: BM2,
      origin: 'registration_ask',
      ask: 1200,
      addition_id: 'addava00000001',
      added_by: 'the dashboard',
      added_at: '2027-02-02',
      reviewed: false,
    }),
  ],
  needs_look: true,
  look_reasons: ['registration_ask_unreviewed'],
})

/** Theodore: no household in CampMinder, so nowhere to put a request. */
export const THEO = row({
  key: '0:1000081',
  household_cm_id: 0,
  household_label: '',
  person_cm_id: 1000081,
  camper_name: 'Theodore Sam-Lindqvist',
  answers: [
    { program_key: 'summer', option_text: 'Session 2', ask: 3400, named_session_cm_id: S2 },
  ],
  enrolled_session_cm_ids: [S2],
  why_not: 'no_household',
  gap_sessions: [{ session_cm_id: S2, program_key: 'summer', campminder_amount: null }],
  can_add: false,
  needs_look: true,
  look_reasons: ['enrolled_no_request'],
})

/** Mateo: registration only with no CampMinder aid: Registration ask only, not Needs a look (Q3-A). */
export const MATEO = row({
  key: '1000009:1000091',
  household_cm_id: 1000009,
  household_label: 'Ana Garcia-Hernández de la Vega',
  person_cm_id: 1000091,
  camper_name: 'Mateo Garcia-Hernández de la Vega',
  filed: false,
  registration_only: true,
  registration_ask: { amount: 300, on: null },
  enrolled_session_cm_ids: [T1],
  why_not: 'registration_only',
  gap_sessions: [{ session_cm_id: T1, program_key: 'summer', campminder_amount: null }],
  can_add: true,
})

/** Liam: a settled request; CampMinder's aid sits on it. Nothing to look at. */
export const LIAM = row({
  key: '1000002:1000021',
  household_cm_id: 1000002,
  household_label: 'Ana Garcia',
  person_cm_id: 1000021,
  camper_name: 'Liam Garcia',
  answers: [
    { program_key: 'summer', option_text: 'Session 4', ask: 4000, named_session_cm_id: S4 },
  ],
  enrolled_session_cm_ids: [S4],
  became: [became({ request_id: 'reqliam00000001', session_cm_id: S4, ask: 4000 })],
  campminder_aid: [{ session_cm_id: S4, amount: 1200, posted_on: '2027-02-10', on_request: true }],
})

/** The Chen household's Family Camp row: an added request (household level, no camper). */
export const CHEN_HH = row({
  key: '1000003:0',
  household_cm_id: 1000003,
  household_label: 'Wei & Lin Chen',
  person_cm_id: 0,
  camper_name: '',
  answers: [{ program_key: 'family_camp', option_text: 'Winter Family Camp', ask: 1100 }],
  enrolled_session_cm_ids: [WFC],
  became: [
    became({
      request_id: 'reqchenhh000001',
      program_key: 'family_camp',
      session_cm_id: WFC,
      origin: 'added',
      ask: 1100,
      addition_id: 'addchenhh00001',
      added_by: 'Jordan Chen',
      added_at: '2027-01-22',
      added_reason: 'Called in before the form opened',
    }),
  ],
})

export const ROWS_2027: FormIntakeRowOut[] = [EMMA, OLIVIA, RILEY, AVA, THEO, MATEO, LIAM, CHEN_HH]

export function formsRead(rows: FormIntakeRowOut[] = ROWS_2027, year = 2027): FormIntakeResponse {
  return {
    year,
    rows,
    counts: {
      needs_look: rows.filter((r) => r.needs_look).length,
      registration_only: rows.filter((r) => r.registration_only).length,
      all: rows.length,
    },
    sessions: SESSIONS,
    grants_waiting_for_camper: 2,
    campminder_aid_on_no_request: 2258,
  }
}

/** Season 2026's D170 line opened: Lucas (registration only, $2,258 on Session 3) and a Family Camp household. */
export const LUCAS = row({
  key: '1000011:1000111',
  household_cm_id: 1000011,
  household_label: 'Rosa Garcia',
  person_cm_id: 1000111,
  camper_name: 'Lucas Garcia',
  filed: false,
  registration_only: true,
  registration_ask: { amount: 2500, on: null },
  enrolled_session_cm_ids: [S3],
  campminder_aid: [{ session_cm_id: S3, amount: 2258, posted_on: '2026-03-09', on_request: false }],
  why_not: 'registration_only',
  gap_sessions: [{ session_cm_id: S3, program_key: 'summer', campminder_amount: 2258 }],
  can_add: true,
  needs_look: true,
  look_reasons: ['campminder_aid'],
})

export const OKAFOR_HH = row({
  key: '1000013:0',
  household_cm_id: 1000013,
  household_label: 'Daniel & Priya Chen-Okafor',
  person_cm_id: 0,
  camper_name: '',
  filed: false,
  enrolled_session_cm_ids: [FC2, WFC],
  campminder_aid: [{ session_cm_id: FC2, amount: 458, posted_on: '2025-10-04', on_request: false }],
  why_not: 'enrolled_no_request',
  gap_sessions: [
    { session_cm_id: FC2, program_key: 'family_camp', campminder_amount: 458 },
    { session_cm_id: WFC, program_key: 'family_camp', campminder_amount: null },
  ],
  can_add: true,
  needs_look: true,
  look_reasons: ['campminder_aid'],
})

export function aidOnNoRequestRead(): AidOnNoRequestResponse {
  return {
    year: 2026,
    total: 2716,
    families: 2,
    sessions: SESSIONS,
    lines: [
      {
        row_key: LUCAS.key,
        household_cm_id: 1000011,
        household_label: 'Rosa Garcia',
        household_tiebreak: '',
        person_cm_id: 1000111,
        camper_name: 'Lucas Garcia',
        session_cm_id: S3,
        pool: 'camp_pool',
        amount: 2258,
        posted_on: '2026-03-09',
        prefill: {
          household_cm_id: 1000011,
          person_cm_id: 1000111,
          session_cm_id: S3,
          ask: 2258,
          round1_campminder: 2258,
        },
        can_add: true,
        gap_sessions: LUCAS.gap_sessions ?? [],
      },
      {
        row_key: OKAFOR_HH.key,
        household_cm_id: 1000013,
        household_label: 'Daniel & Priya Chen-Okafor',
        household_tiebreak: '',
        person_cm_id: 0,
        camper_name: '',
        session_cm_id: FC2,
        pool: 'weekend_pool',
        amount: 458,
        posted_on: '2025-10-04',
        prefill: {
          household_cm_id: 1000013,
          person_cm_id: 0,
          session_cm_id: FC2,
          ask: 458,
          round1_campminder: 458,
        },
        can_add: true,
        gap_sessions: OKAFOR_HH.gap_sessions ?? [],
      },
    ],
  }
}
