/**
 * Fictional pages for the household page's lower card (income, grants and postings, linked
 * households, history): flagged income, two households, links and a worded history. Built on
 * householdFixtures; every name and figure invented (tests/CLAUDE.md's set).
 */
import type {
  ApiAidAnswer,
  ApiAidHistoryEntry,
  ApiAidHouseholdPage,
  ApiAidIncome,
} from '../../../types/api-types'
import { ROW_EMMA, ROW_SAMUEL } from '../requests/gridFixtures'
import { householdCard, householdPage, householdRequest, receiptOut } from './householdFixtures'

export function answer(
  field: string,
  synced: string,
  over: Partial<ApiAidAnswer> = {}
): ApiAidAnswer {
  return {
    field,
    synced,
    effective: synced,
    corrected: false,
    changed_since_correction: false,
    history: [],
    ...over,
  }
}

/** The live build's fourteen answers, all as sent: nothing corrected, nothing flagged. */
export function plainAnswers(): ApiAidAnswer[] {
  return [
    answer('total_gross_income', '84000.00'),
    answer('expected_gross_income', '84000.00'),
    answer('total_adjusted_income', '80000.00'),
    answer('income_confirmed', '81000.00'),
    answer('total_medical_expenses', ''),
    answer('total_edu_expenses', ''),
    answer('total_housing_expenses', '30000.00'),
    answer('total_rent', ''),
    answer('non_retirement_savings', ''),
    answer('num_children', '2'),
    answer('unemployment', 'false'),
    answer('gov_subsidies', 'false'),
    answer('single_parent', 'false'),
    answer('income_override', ''),
  ]
}

export function income(over: Partial<ApiAidIncome> = {}): ApiAidIncome {
  return {
    household_cm_id: 1000001,
    status: 'complete',
    answers: plainAnswers(),
    notes: { special_circumstances: 'One parent changed jobs in January.' },
    flags: [],
    form_people: [],
    ...over,
  }
}

/** Emma's form (1000002) and Samuel's (1000010) disagree on gross income: the server's variant shape. */
export const GROSS_CONFLICT = {
  code: 'income_conflict',
  detail: {
    fields: {
      total_gross_income: [
        { value: 84000, person_cm_ids: [1000002] },
        { value: 90000, person_cm_ids: [1000010] },
      ],
    },
    resolved_by_correction: false,
  },
}

/** One household: nothing corrected, nothing flagged. */
export const PLAIN_PAGE: ApiAidHouseholdPage = householdPage({ incomes: [income()] })

/** One household, gross income flagged (income_conflict) and the children corrected. */
export const FLAGGED_PAGE: ApiAidHouseholdPage = householdPage({
  incomes: [
    income({
      answers: plainAnswers().map((a) =>
        a.field === 'num_children' ? { ...a, effective: '3', corrected: true } : a
      ),
      flags: [GROSS_CONFLICT],
    }),
  ],
})

/** Two households, each with its own form; the Garcia household (1000003) has a link to a third. */
export const TWO_HOUSEHOLD_PAGE: ApiAidHouseholdPage = householdPage({
  households: [
    householdCard({ request_ids: ['reqemma00000001'] }),
    householdCard({
      household_cm_id: 1000003,
      chip: 2,
      family_name: 'The Garcia Family',
      adults: ['Olivia Garcia'],
      request_ids: ['reqsamuel000005'],
    }),
  ],
  requests: [
    householdRequest(ROW_EMMA),
    householdRequest({ ...ROW_SAMUEL, household_cm_id: 1000003 }, { receipts: [receiptOut(1)] }),
  ],
  incomes: [
    income(),
    income({
      household_cm_id: 1000003,
      answers: plainAnswers().map((a) =>
        a.field === 'total_adjusted_income'
          ? { ...a, synced: '71500.00', effective: '71500.00' }
          : a
      ),
      notes: { special_circumstances: 'Shared custody, week on, week off.' },
    }),
  ],
  links: [
    {
      id: 'link00000000001',
      year: 2027,
      household_cm_id: 1000004,
      family_key: 'fam1',
      source: 'staff',
      excluded: true,
      note: 'Grandparent address, not a payer',
      actor: 'test@example.com',
    },
  ],
})

function entry(over: Partial<ApiAidHistoryEntry>): ApiAidHistoryEntry {
  return {
    at: '2027-02-02T17:00:00Z',
    action: 'create',
    entity: 'aid_requests',
    entity_id: 'reqemma00000001',
    request_id: 'reqemma00000001',
    actor: 'system:intake',
    reason: '',
    operation_id: 'op0000000000001',
    before: null,
    after: null,
    ...over,
  }
}

/** The family's log as the server sends it: intake, a correction, a staff tick, the ledger's tick. */
export const HISTORY: ApiAidHistoryEntry[] = [
  entry({
    entity: 'aid_applications',
    entity_id: 'app000000000001',
    request_id: null,
    after: { household_cm_id: 1000001, status: 'active' },
  }),
  entry({ after: { ask: 2000, person_cm_id: 1000002 } }),
  entry({
    at: '2027-02-09T17:00:00Z',
    action: 'correct',
    entity: 'aid_application_corrections',
    entity_id: 'cor000000000001',
    request_id: null,
    actor: 'test@example.com',
    reason: 'Pay stub shows the new salary',
    operation_id: 'op0000000000002',
    after: { field: 'expected_gross_income', original_value: '90000', new_value: '84200' },
  }),
  entry({
    at: '2027-03-09T18:00:00Z',
    action: 'post',
    entity: 'aid_decisions',
    entity_id: 'reqsamuel000005:1',
    request_id: 'reqsamuel000005',
    actor: 'test@example.com',
    operation_id: 'op0000000000003',
    after: { amount: '1800', round: 1, lock_source: 'tick', event: 'post' },
  }),
  entry({
    at: '2027-03-10T09:00:00Z',
    action: 'post',
    entity: 'aid_decisions',
    entity_id: 'reqemma00000001:1',
    actor: 'system:ledger',
    operation_id: 'op0000000000004',
    after: { amount: '1420', round: 1, lock_source: 'ledger', event: 'post' },
  }),
  entry({
    at: '2027-03-14T18:00:00Z',
    action: 'accept',
    entity: 'aid_decisions',
    entity_id: 'reqsamuel000005:1',
    request_id: 'reqsamuel000005',
    actor: 'test@example.com',
    operation_id: 'op0000000000005',
    after: { round: 1, event: 'accept' },
  }),
]

/**
 * The household page with that log. Samuel's Round 1 was ticked by Test User (the receipt names who
 * ticked it), so the sign-in that logged the tick reads as "Test".
 */
export const HISTORY_PAGE: ApiAidHouseholdPage = householdPage({ history: HISTORY })
