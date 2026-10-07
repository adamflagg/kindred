/**
 * Rules fixtures (slice 2): an invented 2027 rules document in the shape the server sends
 * (`AidRulesOutput`: decimals as strings), its approved read and its draft. Program keys and pools
 * are generic ("summer", "weekend"; "pool_a", "pool_b"); session ids from 1000101; every figure is
 * invented and prices nothing real. Staff appear as "Test User" (tests/CLAUDE.md).
 */
import type {
  ApiAidApprovedRules,
  ApiAidApprovedSection,
  ApiAidRulesDocument,
  ApiAidRulesDraft,
  ApiAidRulesSection,
} from '../../../../types/api-types'
import { MONEY_SECTIONS, SEASON_SECTIONS } from './rulesModel'

export const RULES_DOCUMENT: ApiAidRulesDocument = {
  schema_version: 1,
  year: 2027,
  income: {
    weights: { prior_year: '0.5', current_year: '0.5' },
    basis: 'gross',
    current_year_zero_fallback: 'blend',
    medical_threshold: '5000',
    medical_rate: '1',
    education_threshold: '5000',
    education_rate: '1',
    savings_threshold: '20000',
    savings_inclusion_rate: '0.1',
    extra_terms: [],
    dependents_mode: 'income_reduction',
    per_dependent_reduction: '4000',
    floor: '0',
    floor_applies_after: 'all_reductions',
  },
  tiers: {
    bands: [
      { lower: '0', upper: '40000' },
      { lower: '40001', upper: '70000' },
      { lower: '70001', upper: null },
    ],
    income_ceiling: null,
    floor_tier: 1,
  },
  equity: { criteria: [], weights: {}, aggregation: 'ceil', max_shift: null },
  award_tables: {
    general: {
      inherits: null,
      tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '60' }, '3': { r1_pct: '20' } },
      overrides: {},
    },
  },
  programs: {
    summer: {
      label: 'Summer',
      session_cm_ids: [1000101, 1000102],
      session_types: [],
      r1_table: 'general',
      equity_class: null,
      budget_pool: 'pool_a',
      cost_source: 'catalog',
      open_to_aid: true,
    },
    weekend: {
      label: 'Weekend',
      session_cm_ids: [1000201],
      session_types: [],
      r1_table: 'general',
      equity_class: null,
      budget_pool: 'pool_b',
      cost_source: 'per_person',
      open_to_aid: true,
    },
  },
  cost: {
    tuition: { '1000101': '4000', '1000102': '6000' },
    family_rates: [{ session_cm_id: 1000201, standard: '500', infant: '0' }],
    infant_age_cutoff_months: 24,
    override_reasons: ['headcount'],
  },
  grants: {
    offset_programs: ['summer'],
    offset_mode: 'dollar',
    minimum_after_grants: true,
    minimum_when_fully_covered: false,
    minimum_capped_at_share: true,
    count_when: 'committed',
    late_grant_policy: 'flag',
  },
  awards: {
    minimum: '100',
    minimum_when_cost_unknown: false,
    minimum_without_table: false,
    rounding: 'half_up',
    ask_cap: true,
    decision_types: {},
  },
  round2: {
    cap_subtracts_grants: false,
    cap_by_original_ask: false,
    tables: { general: { inherits: null, tiers: { '1': { total_pct: '95' } }, overrides: {} } },
    program_tables: { summer: 'general', weekend: null },
    total_cap: null,
  },
  round3: {
    require_round2: true,
    require_statement_of_need: true,
    max_amount: null,
    max_total_pct_of_cost: null,
    registrar_limit: '300',
  },
  budget: {
    total: '1000000',
    pools: {
      pool_a: { label: 'Pool A', share_pct: '90' },
      pool_b: { label: 'Pool B', share_pct: '10' },
    },
  },
  quality_checks: {
    checks: { placeholder_income: { enabled: true, severity: 'hold', threshold: null } },
  },
  milestones: {
    application_deadline: '2027-01-31',
    r1_run: null,
    response_deadline: null,
    r2_window_start: null,
    r2_window_end: null,
    r3_window_start: null,
    r3_window_end: null,
  },
}

/** A section's JSON from the document, as the approved read's `content` carries it. */
export function contentOf(section: ApiAidRulesSection): Record<string, unknown> {
  const value: unknown = RULES_DOCUMENT[section]
  return value as Record<string, unknown>
}

const ALL: readonly ApiAidRulesSection[] = [...MONEY_SECTIONS, ...SEASON_SECTIONS]

function approved(section: ApiAidRulesSection): ApiAidApprovedSection {
  return {
    section,
    version: 3,
    state: section === 'income' ? 'locked' : 'approved',
    approved_by: 'Test User',
    approved_at: '2027-01-20T18:00:00Z',
    note: 'Finance, Jan 20 meeting',
    locked_at: section === 'income' ? '2027-03-09T18:00:00Z' : null,
    content: contentOf(section),
  }
}

/** Every section approved in v3, income locked by the first Round 1 posting; milestones never approved. */
export const APPROVED_RULES: ApiAidApprovedRules = {
  year: 2027,
  version: 3,
  sections: ALL.map((section) =>
    section === 'milestones'
      ? {
          section,
          version: null,
          state: 'draft',
          approved_by: null,
          approved_at: null,
          note: null,
          locked_at: null,
          content: null,
        }
      : approved(section)
  ),
}

/**
 * The rules draft, v4: the award table's tier 2 moved 60 → 55 (a draft, edited by Test User from
 * kept option B2), every other section as approved, and one validation warning on the budget.
 */
export function rulesDraft(): ApiAidRulesDraft {
  const tables = RULES_DOCUMENT.award_tables
  return {
    year: 2027,
    version: 4,
    parent_year: 2027,
    parent_version: 3,
    approved_version: 3,
    document: {
      ...RULES_DOCUMENT,
      award_tables: {
        ...tables,
        general: {
          inherits: null,
          tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '55' }, '3': { r1_pct: '20' } },
          overrides: {},
        },
      },
    },
    sections: ALL.map((section) =>
      section === 'award_tables'
        ? {
            section,
            status: {
              state: 'draft',
              edited_by: 'Test User',
              edited_at: '2027-01-21T17:00:00Z',
              edited_via: 'B2',
            },
            changes: [
              {
                path: ['general', 'tiers', '2', 'r1_pct'],
                kind: 'changed',
                before: '60',
                after: '55',
              },
            ],
            errors: 0,
            warnings: 0,
            fingerprint: `fp-${section}-v4`,
          }
        : {
            section,
            status:
              section === 'income'
                ? {
                    state: 'locked',
                    approved_by: 'Test User',
                    approved_at: '2027-01-20T18:00:00Z',
                    locked_at: '2027-03-09T18:00:00Z',
                  }
                : {
                    state: 'approved',
                    approved_by: 'Test User',
                    approved_at: '2027-01-20T18:00:00Z',
                    note: 'Finance, Jan 20 meeting',
                  },
            changes: [],
            errors: section === 'budget' ? 1 : 0,
            warnings: 0,
            fingerprint: `fp-${section}-v4`,
          }
    ),
    report: {
      issues: [
        {
          section: 'budget',
          code: 'pool_shares_not_100',
          severity: 'error',
          path: 'budget.pools',
          message: 'Pool shares sum to 99%, not 100%',
        },
      ],
    },
  }
}
