/**
 * Adult aid form fixtures in the approved mock's shapes (adult aid form mock v2, season 2027 as of Nov 12, 14:20 camp
 * time). Fictional names (tests/CLAUDE.md's set and the mock's), generic ids, example.com addresses.
 */
import type {
  FormChangeOut,
  FormResponseOut,
  GoogleFormStatusOut,
  LinkCandidatesOut,
  FormCandidateOut,
  FormFigureOut,
} from './intakeTypes'
import type { IntakeSessionOut } from './intakeTypes'

export const WW = 1000301
export const FC2K = 1000302
export const FC3 = 1000303
export const FC3B = 1000304
export const FC4 = 1000305
export const FC4A = 1000306
export const FC6 = 1000307
export const FC6A = 1000308

export const ADULT_SESSIONS: IntakeSessionOut[] = [
  {
    session_cm_id: WW,
    name: "Women's Weekend",
    session_type: 'adult',
    program_key: 'adult_weekend',
    program_family: 'adult_weekend',
  },
  {
    session_cm_id: FC2K,
    name: 'Family Camp 2: Keshet',
    session_type: 'family',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC3,
    name: 'Family Camp 3',
    session_type: 'family',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC3B,
    name: 'Family Camp 3: Cabin Weekend',
    session_type: 'family',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC4,
    name: 'Family Camp 4: Labor Day Weekend',
    session_type: 'family',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC4A,
    name: 'Adult Reg: Family Camp 4 (Labor Day Weekend)',
    session_type: 'family_adult',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC6,
    name: 'Family Camp 6',
    session_type: 'family',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
  {
    session_cm_id: FC6A,
    name: 'Adult Reg: Family Camp 6',
    session_type: 'family_adult',
    program_key: 'family_camp',
    program_family: 'family_camp',
  },
]

/** The five priced figures and three that are not, every one read cleanly unless a test says otherwise. */
export function figures(
  over: Readonly<Record<string, Partial<FormFigureOut> | number | null>> = {}
): FormFigureOut[] {
  const base: Record<string, number | null> = {
    ask: 400,
    total_gross_income: 80000,
    expected_gross_income: 72000,
    non_retirement_savings: 30000,
    total_medical_expenses: 2000,
    total_housing_expenses: 0,
    total_rent: 2200,
    student_debt: 250,
  }
  return Object.entries(base).map(([field, value]) => {
    const o = over[field]
    if (o === undefined) return { field, value }
    if (o === null || typeof o === 'number') return { field, value: o }
    return { field, value, ...o }
  })
}

export function response(over: Partial<FormResponseOut> = {}): FormResponseOut {
  return {
    id: 'rec000000000001',
    response_id: 'resp-rachel',
    match_status: 'auto',
    to_link: false,
    row_key: '1000009:1000091',
    form_status: 'live',
    name_typed: 'Rachel Garcia',
    program_key: 'adult_weekend',
    program_choice: "Women's Weekend (Oct 14-17)",
    weekend_session_cm_id: WW,
    ask: 400,
    submitted_at: '2026-11-05T17:00:00Z',
    figures: figures(),
    unemployment: false,
    num_children: 0,
    special_circumstances: 'I lost my job in June and started a new one in September.',
    signature_typed: 'Rachel Garcia',
    agreement_date: '2026-11-05',
    superseded: [],
    candidates: [
      {
        person_cm_id: 1000091,
        household_cm_id: 1000009,
        camper_name: 'Rachel Garcia',
        household_label: 'Rachel Garcia',
        signals: ['name', 'birthdate', 'email'],
        session_cm_ids: [WW],
        registration_status: 'enrolled',
      },
    ],
    look_reasons: [],
    ...over,
  }
}

const DANA_OKAFOR: FormCandidateOut = {
  person_cm_id: 1000121,
  household_cm_id: 1000012,
  camper_name: 'Dana Okafor',
  household_label: 'Dana Okafor & Sam Lee',
  signals: ['name'],
  session_cm_ids: [FC4A],
  registration_status: 'enrolled',
  // The typed email is someone else's in her household: a tie-break, never a match.
  household_email: true,
}
const DANA_OKAFOR_REYES: FormCandidateOut = {
  person_cm_id: 1000131,
  household_cm_id: 1000013,
  camper_name: 'Dana Okafor-Reyes',
  household_label: 'Dana Okafor-Reyes',
  signals: ['name'],
  session_cm_ids: [FC4A],
  registration_status: 'applied',
}

/** Suggested with two candidates, both on name only (the mock's Dana). */
export const DANA = response({
  id: 'rec000000000002',
  response_id: 'resp-dana',
  match_status: 'suggested',
  to_link: true,
  row_key: '',
  name_typed: 'Dana Okafor',
  program_key: 'family_camp',
  program_choice: 'Family Camp 4: Labor Day (Sep 3-6)',
  weekend_session_cm_id: FC4,
  ask: 600,
  submitted_at: '2026-11-08T18:00:00Z',
  signature_typed: 'Dana Okafor',
  special_circumstances: '',
  figures: figures({
    ask: 600,
    total_medical_expenses: 6400,
  }),
  candidates: [DANA_OKAFOR, DANA_OKAFOR_REYES],
})

/** Suggested with one candidate, the birthdate's day and month swapped (the mock's Noah). */
export const NOAH = response({
  id: 'rec000000000003',
  response_id: 'resp-noah',
  match_status: 'suggested',
  to_link: true,
  row_key: '',
  name_typed: 'Noah Johnson',
  program_key: 'family_camp',
  program_choice: 'Family Camp 6 (Sep 16-19)',
  weekend_session_cm_id: FC6,
  ask: 450,
  candidates: [
    {
      person_cm_id: 1000141,
      household_cm_id: 1000014,
      camper_name: 'Noah Johnson',
      household_label: 'Mia & Noah Johnson',
      signals: ['name'],
      session_cm_ids: [FC6A],
      registration_status: 'enrolled',
    },
  ],
})

/** Registered elsewhere: chose Family Camp 2, registered for Family Camp 4 Adults (the mock's Emma). */
export const EMMA_GF = response({
  id: 'rec000000000004',
  response_id: 'resp-emma',
  match_status: 'registered_elsewhere',
  to_link: true,
  row_key: '',
  name_typed: 'Emma Johnson',
  program_key: 'family_camp',
  program_choice: 'Family Camp 2: Keshet (Aug 19-22)',
  weekend_session_cm_id: FC2K,
  ask: 300,
  candidates: [
    {
      person_cm_id: 1000151,
      household_cm_id: 1000015,
      camper_name: 'Emma Johnson',
      household_label: 'Emma Johnson',
      signals: ['name', 'birthdate', 'email'],
      session_cm_ids: [FC4A],
      registration_status: 'enrolled',
    },
  ],
})

/** Not registered: no 2027 registration matches (the mock's Casey). */
export const CASEY = response({
  id: 'rec000000000005',
  response_id: 'resp-casey',
  match_status: 'not_registered',
  to_link: true,
  row_key: '',
  name_typed: 'Casey Sam',
  ask: 400,
  candidates: [],
})

/** Ignored, with its kind, reason, who and when (the mock's Lin). */
export const LIN = response({
  id: 'rec000000000006',
  response_id: 'resp-lin',
  match_status: 'ignored',
  to_link: false,
  row_key: '',
  name_typed: 'Lin Chen',
  program_key: 'family_camp',
  program_choice: 'Family Camp 4: Labor Day (Sep 3-6)',
  weekend_session_cm_id: FC4,
  ask: 500,
  ignored_kind: 'not_asking',
  ignored_reason: "Called: says she doesn't need aid this year",
  ignored_by: 'pat.garcia@example.com',
  ignored_at: '2026-11-07T18:00:00Z',
  candidates: [],
})

/** Hedged figures read with their notes (the mock's Grace, K2). */
export const GRACE = response({
  id: 'rec000000000007',
  response_id: 'resp-grace',
  row_key: '1000016:1000161',
  name_typed: 'Grace Whitfield',
  program_key: 'family_camp',
  program_choice: 'Family Camp 4: Labor Day (Sep 3-6)',
  weekend_session_cm_id: FC4,
  ask: 700,
  submitted_at: '2026-11-06T18:00:00Z',
  signature_typed: 'Grace Whitfield',
  special_circumstances: '',
  figures: figures({
    ask: 700,
    total_gross_income: { value: 85000, typed: 'approx 85k', note: 'read “approx 85k” as $85,000' },
    expected_gross_income: { value: 85000, typed: '85K', note: 'read “85K” as $85,000' },
    non_retirement_savings: { value: 0, typed: 'none', note: 'read “none” as $0, reported' },
    total_rent: { value: 18000, typed: '$1,500/mo', note: 'read as $18,000 a year' },
    student_debt: 0,
  }),
  candidates: [
    {
      person_cm_id: 1000161,
      household_cm_id: 1000016,
      camper_name: 'Grace Chen-Whitfield',
      household_label: 'Grace & Tom Chen-Whitfield',
      signals: ['birthdate', 'email'],
      session_cm_ids: [FC4A],
      registration_status: 'enrolled',
    },
  ],
})

/** A range left unknown, and an earlier response replaced before any decision (the mock's Hannah). */
export const HANNAH = response({
  id: 'rec000000000008',
  response_id: 'resp-hannah-2',
  row_key: '1000017:1000171',
  name_typed: 'Hannah Sam-Lindqvist',
  ask: 450,
  submitted_at: '2026-11-09T18:00:00Z',
  figures: figures({
    ask: 450,
    expected_gross_income: {
      value: null,
      typed: 'between 70 and 80k',
      note: '“between 70 and 80k”: a range, not read',
    },
  }),
  superseded: [
    {
      response_id: 'resp-hannah-1',
      submitted_at: '2026-11-05T18:00:00Z',
      replaced_at: '2026-11-09T18:00:00Z',
      ask: 450,
      total_gross_income: 67000,
    },
  ],
})

/** A second response after Round 1: flagged, not applied (the mock's Jordan). */
export const JORDAN = response({
  id: 'rec000000000009',
  response_id: 'resp-jordan',
  row_key: '1000018:1000181',
  name_typed: 'Jordan Sam',
  program_key: 'family_camp',
  program_choice: 'Family Camp 4: Labor Day (Sep 3-6)',
  weekend_session_cm_id: FC4,
  ask: 600,
  submitted_at: '2026-11-04T18:00:00Z',
  figures: figures({ ask: 600, total_gross_income: 62000 }),
  look_reasons: ['form_changed_after_decision'],
})

/** A response deleted in Google, kept here (the mock's Ana). */
export const ANA = response({
  id: 'rec000000000010',
  response_id: 'resp-ana',
  row_key: '1000019:1000191',
  name_typed: 'Ana Garcia',
  ask: 350,
  submitted_at: '2026-11-04T18:00:00Z',
  form_status: 'deleted',
  look_reasons: ['form_response_deleted'],
})

export const LAST_READ: GoogleFormStatusOut = {
  last_pulled_at: '2026-11-12T22:20:00Z',
  refused: false,
}
export const REFUSED: GoogleFormStatusOut = {
  last_pulled_at: '2026-11-12T22:20:00Z',
  refused: true,
  returned: 0,
  expected: 12,
  last_pull_status: 'refused: 12 of 12 responses missing · 0 responses',
}

/** The change a decided request's response made (GF-4), as its Became carries it: Jordan's second response. */
export const JORDAN_CHANGE: FormChangeOut = {
  kind: 'changed_after_decision',
  at: '2026-11-10T18:00:00Z',
  reviewed: false,
}
/** Ana's response deleted in Google. */
export const ANA_CHANGE: FormChangeOut = {
  kind: 'deleted',
  at: '2026-11-11T18:00:00Z',
  reviewed: false,
}

/** Link…'s read for Dana: the respondent email is here and nowhere else. */
export const DANA_LINK: LinkCandidatesOut = {
  id: DANA.id,
  response_id: DANA.response_id,
  name_typed: 'Dana Okafor',
  birthdate_typed: '1986-03-12',
  respondent_email: 'sam.lee@example.com',
  program_choice: 'Family Camp 4: Labor Day (Sep 3-6)',
  candidates: [
    { ...DANA_OKAFOR, birthdate: '1985-09-30', email: 'dana.okafor@example.com' },
    { ...DANA_OKAFOR_REYES, birthdate: '1979-01-14', email: 'dokreyes@example.com' },
  ],
}
