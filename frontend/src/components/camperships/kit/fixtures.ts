/**
 * Fictional Camperships data for the kit's tests and the /aid/kit gallery. Names are
 * tests/CLAUDE.md's set; every rule (percentages, minimums, caps) and every figure is invented.
 */
import type { AidTraceStep, TraceValue } from './receiptModel'

function step(
  key: string,
  label: string,
  value: TraceValue,
  inputs: Record<string, TraceValue> = {},
  bound: string | null = null
): AidTraceStep {
  return { key, label, value, inputs, bound, note: null }
}

const INCOME_120K = [
  step('weighted_income', 'Weighted income', '120000.00', {
    prior_year: '118000.00',
    current_year: '126000.00',
    weight_prior: '0.75',
    weight_current: '0.25',
    basis: 'gross',
    override_mode: null,
  }),
  step('income_adjustments', 'Income adjustments', '0.00', {
    medical_excess: '0.00',
    dependent_reduction: '0.00',
  }),
  step('adjusted_income', 'Adjusted household income', '120000.00', {
    base: '120000.00',
    floor: '0.00',
  }),
]

const GRANTS_NONE = step('grants', 'Outside grants', '0.00', {
  count_when: 'committed',
  offset_mode: 'dollar',
  late_left_out: 0,
})

/** Round 1 set by the family's ask. */
export const TRACE_CAPPED_BY_ASK: readonly AidTraceStep[] = [
  ...INCOME_120K,
  step('income_tier', 'Income tier', 5, { adjusted_income: '120000.00' }),
  step('equity_shift', 'Equity shift', 0, {
    equity_class: 'summer',
    criteria_met: '',
    weight_sum: '0.00',
  }),
  step('final_tier', 'Final tier', 5, { income_tier: 5, equity_shift: 0 }),
  step('cost', 'Cost', '5000.00', {
    source: 'catalog',
    resolved: '5000.00',
    incentive_reduction: '0.00',
  }),
  GRANTS_NONE,
  step('r1_pct', 'Round 1 percentage', '40.00', { table: 'summer', tier: 5, source: 'table' }),
  step(
    'r1_potential',
    'Round 1 potential',
    '2000.00',
    { pct: '40.00', cost: '5000.00', grants: '0.00', minimum: '100.00' },
    'table'
  ),
  step('r1', 'Round 1 award', '1500.00', { ask: '1500.00', potential: '2000.00' }, 'ask'),
  step('total', 'Total award', '1500.00', {
    r1: '1500.00',
    r2: null,
    r3: null,
    top_up: '0.00',
    discretionary: '0.00',
  }),
]

/** Round 1 set by the table; the appeal limited by the Round 2 cap. */
export const TRACE_ROUND2_CAPPED: readonly AidTraceStep[] = [
  step('adjusted_income', 'Adjusted household income', '80000.00', {
    base: '80000.00',
    floor: '0.00',
  }),
  step('income_tier', 'Income tier', 3, { adjusted_income: '80000.00' }),
  step('equity_shift', 'Equity shift', 0, {
    equity_class: 'summer',
    criteria_met: '',
    weight_sum: '0.00',
  }),
  step('final_tier', 'Final tier', 3, { income_tier: 3, equity_shift: 0 }),
  step('cost', 'Cost', '5000.00', {
    source: 'catalog',
    resolved: '5000.00',
    incentive_reduction: '0.00',
  }),
  GRANTS_NONE,
  step('r1_pct', 'Round 1 percentage', '70.00', { table: 'summer', tier: 3, source: 'table' }),
  step(
    'r1_potential',
    'Round 1 potential',
    '3500.00',
    { pct: '70.00', cost: '5000.00', grants: '0.00', minimum: '100.00' },
    'table'
  ),
  step('r1', 'Round 1 award', '3500.00', { ask: '4000.00', potential: '3500.00' }, 'table'),
  step(
    'r2_cap',
    'Round 2 cap',
    '1000.00',
    { total_pct: '90.00', cost: '5000.00', r1: '3500.00', grants_subtracted: false },
    'cap'
  ),
  step('r2', 'Round 2 award', '1000.00', { appeal: '2500.00', cap: '1000.00' }, 'cap'),
  step('total', 'Total award', '4500.00', {
    r1: '3500.00',
    r2: '1000.00',
    r3: null,
    top_up: '0.00',
    discretionary: '0.00',
  }),
]

/** Above the income ceiling: no award, said why (engine.py emits no percentage step here). */
export const TRACE_INCOME_CEILING: readonly AidTraceStep[] = [
  step('adjusted_income', 'Adjusted household income', '400000.00', {
    base: '400000.00',
    floor: '0.00',
  }),
  step('income_tier', 'Income tier', 9, { adjusted_income: '400000.00' }),
  step('equity_shift', 'Equity shift', 0, {
    equity_class: 'summer',
    criteria_met: '',
    weight_sum: '0.00',
  }),
  step('final_tier', 'Final tier', 9, { income_tier: 9, equity_shift: 0 }),
  step('cost', 'Cost', '5000.00', {
    source: 'catalog',
    resolved: '5000.00',
    incentive_reduction: '0.00',
  }),
  step('r1', 'Round 1 award', '0.00', {}, 'income_ceiling'),
  step('total', 'Total award', '0.00', {
    r1: '0.00',
    r2: null,
    r3: null,
    top_up: '0.00',
    discretionary: '0.00',
  }),
]

/**
 * A posted Round 1 that the rules would now work out lower: the locked amount stands (D43, D52;
 * engine.py `_lock` emits `r1_locked` after `r1`), and the total uses it.
 */
export const TRACE_ROUND1_LOCKED: readonly AidTraceStep[] = [
  ...TRACE_CAPPED_BY_ASK.slice(0, -1),
  step('r1_locked', 'Round 1 as posted', '1800.00', { worked_out: '1500.00' }, 'locked'),
  step('total', 'Total award', '1800.00', {
    r1: '1800.00',
    r2: null,
    r3: null,
    top_up: '0.00',
    discretionary: '0.00',
  }),
]
