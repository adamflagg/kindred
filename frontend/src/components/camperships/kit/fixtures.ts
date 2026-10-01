/**
 * Fictional Camperships data for the kit's tests and the /aid/kit gallery. Names are
 * tests/CLAUDE.md's set; every rule (percentages, minimums, caps) and every figure is invented.
 * The traces carry the keys the calculator really emits (bunking/financial_aid/calculator/*.py),
 * Decimals as strings, so the receipt is exercised on engine-shaped input.
 */
import type { AidTraceStep, TraceValue } from './receiptModel'

export function traceStep(
  key: string,
  label: string,
  value: TraceValue,
  inputs: Record<string, TraceValue> = {},
  bound: string | null = null,
  note: string | null = null
): AidTraceStep {
  return { key, label, value, inputs, bound, note }
}

const step = traceStep

function income(adjusted: string, tier: number, shift = 0): AidTraceStep[] {
  return [
    step('weighted_income', 'Weighted income', adjusted, {
      prior_year: adjusted,
      current_year: adjusted,
      weight_prior: '0.75',
      weight_current: '0.25',
      basis: 'gross',
      override_mode: null,
    }),
    step('income_adjustments', 'Income adjustments', '0.00', {
      medical_excess: '0.00',
      education_excess: '0.00',
      savings_excess: '0.00',
      extra_terms: '0.00',
      dependent_reduction: '0.00',
    }),
    step(
      'adjusted_income',
      'Adjusted household income',
      adjusted,
      { base: adjusted, after_dependents: adjusted, floor: '0.00' },
      null,
      'floor tested after deductions'
    ),
    step('income_tier', 'Income tier', tier, { adjusted_income: adjusted }),
    step('equity_shift', 'Equity shift', shift, {
      equity_class: 'summer',
      criteria_met: '',
      weight_sum: '0.00',
      aggregation: 'sum',
    }),
    step('final_tier', 'Final tier', tier - shift, { income_tier: tier, equity_shift: shift }),
  ]
}

function cost(amount = '5000.00', incentive = '0.00'): AidTraceStep {
  return step('cost', 'Cost', amount, {
    source: 'catalog',
    resolved: '5000.00',
    incentive_reduction: incentive,
  })
}

function grants(amount = '0.00', mode: 'dollar' | 'reduce_cost_basis' = 'dollar'): AidTraceStep {
  return step('grants', 'Outside grants', amount, {
    count_when: 'committed',
    offset_mode: mode,
    late_left_out: 0,
  })
}

function r1Steps(opts: {
  pct: string
  potential: string
  minimum: string
  grants?: string
  cost?: string
  r1: string
  ask: string | null
  potentialBound: string
  r1Bound: string
  r1Note?: string | null
}): AidTraceStep[] {
  return [
    step('r1_pct', 'Round 1 percentage', opts.pct, { table: 'summer', tier: 5, source: 'table' }),
    step(
      'r1_potential',
      'Round 1 potential',
      opts.potential,
      {
        pct: opts.pct,
        cost: opts.cost ?? '5000.00',
        grants: opts.grants ?? '0.00',
        minimum: opts.minimum,
        minimum_uncapped: opts.minimum,
      },
      opts.potentialBound
    ),
    step(
      'r1',
      'Round 1 award',
      opts.r1,
      { ask: opts.ask, potential: opts.potential },
      opts.r1Bound,
      opts.r1Note ?? null
    ),
  ]
}

function total(
  r1: string,
  r2: string | null,
  extras: { top_up?: string; discretionary?: string } = {}
): AidTraceStep {
  const sum =
    Number(r1) + Number(r2 ?? 0) + Number(extras.top_up ?? 0) + Number(extras.discretionary ?? 0)
  return step('total', 'Total award', sum.toFixed(2), {
    r1,
    r2,
    r3: null,
    top_up: extras.top_up ?? '0.00',
    discretionary: extras.discretionary ?? '0.00',
  })
}

/** Round 1 set by the family's ask. */
export const TRACE_CAPPED_BY_ASK: readonly AidTraceStep[] = [
  ...income('120000.00', 5),
  cost(),
  grants(),
  ...r1Steps({
    pct: '40.00',
    potential: '2000.00',
    minimum: '100.00',
    r1: '1500.00',
    ask: '1500.00',
    potentialBound: 'table',
    r1Bound: 'ask',
  }),
  total('1500.00', null),
]

/** Round 1 set by the table; the appeal limited by the Round 2 cap. */
export const TRACE_ROUND2_CAPPED: readonly AidTraceStep[] = [
  ...income('80000.00', 3),
  cost(),
  grants(),
  ...r1Steps({
    pct: '70.00',
    potential: '3500.00',
    minimum: '100.00',
    r1: '3500.00',
    ask: '4000.00',
    potentialBound: 'table',
    r1Bound: 'table',
  }),
  step(
    'r2_cap',
    'Round 2 cap',
    '1000.00',
    {
      total_pct: '90.00',
      cost: '5000.00',
      r1: '3500.00',
      grants_subtracted: false,
      grants_since_round1: '0.00',
    },
    'cap'
  ),
  step('r2', 'Round 2 award', '1000.00', { appeal: '2500.00', cap: '1000.00' }, 'cap'),
  total('3500.00', '1000.00'),
]

/** Above the income ceiling: no award, said why (engine.py emits no percentage step here). */
export const TRACE_INCOME_CEILING: readonly AidTraceStep[] = [
  ...income('400000.00', 9),
  cost(),
  grants(),
  step(
    'r1',
    'Round 1 award',
    '0.00',
    {},
    'income_ceiling',
    'Adjusted income is above the income ceiling'
  ),
  total('0.00', null),
]

/**
 * A posted Round 1 that the rules would now work out lower: the locked amount stands (D43, D52;
 * engine.py `_lock` emits `r1_locked` after `r1`), and the total uses it.
 */
export const TRACE_ROUND1_LOCKED: readonly AidTraceStep[] = [
  ...TRACE_CAPPED_BY_ASK.slice(0, -1),
  step(
    'r1_locked',
    'Round 1 as posted',
    '1800.00',
    { worked_out: '1500.00' },
    'locked',
    'Locked when it was posted; later rounds build on this amount'
  ),
  total('1800.00', null),
]

/** 1% of the cost is under the minimum, so the minimum is the award. */
export const TRACE_MINIMUM_RAISED: readonly AidTraceStep[] = [
  ...income('30000.00', 1),
  cost(),
  grants(),
  ...r1Steps({
    pct: '1.00',
    potential: '100.00',
    minimum: '100.00',
    r1: '100.00',
    ask: '500.00',
    potentialBound: 'minimum',
    r1Bound: 'minimum',
  }),
  total('100.00', null),
]

/** The minimum lifts the potential, then the family's smaller ask limits the award. */
export const TRACE_MINIMUM_THEN_ASK: readonly AidTraceStep[] = [
  ...income('30000.00', 1),
  cost(),
  grants(),
  ...r1Steps({
    pct: '1.00',
    potential: '100.00',
    minimum: '100.00',
    r1: '80.00',
    ask: '80.00',
    potentialBound: 'minimum',
    r1Bound: 'ask',
  }),
  total('80.00', null),
]

/** $500 of grants taken off the award dollar for dollar. */
export const TRACE_GRANTS_DOLLAR: readonly AidTraceStep[] = [
  ...income('120000.00', 5),
  cost(),
  grants('500.00', 'dollar'),
  ...r1Steps({
    pct: '40.00',
    potential: '1500.00',
    minimum: '100.00',
    grants: '500.00',
    r1: '1500.00',
    ask: '3000.00',
    potentialBound: 'table',
    r1Bound: 'table',
  }),
  total('1500.00', null),
]

/** $500 of grants taken off the cost before the percentage. */
export const TRACE_GRANTS_REDUCE_COST: readonly AidTraceStep[] = [
  ...income('120000.00', 5),
  cost(),
  grants('500.00', 'reduce_cost_basis'),
  ...r1Steps({
    pct: '40.00',
    potential: '1800.00',
    minimum: '100.00',
    grants: '500.00',
    r1: '1800.00',
    ask: '3000.00',
    potentialBound: 'table',
    r1Bound: 'table',
  }),
  total('1800.00', null),
]

/** A named top-up that the total includes. */
export const TRACE_TOP_UP: readonly AidTraceStep[] = [
  ...TRACE_CAPPED_BY_ASK.slice(0, -1),
  step('top_up', 'Top-up: Named top-up', '400.00', { kind: 'top_up' }),
  total('1500.00', null, { top_up: '400.00' }),
]

/** A staff-entered discretionary amount the total includes; it has no step of its own. */
export const TRACE_DISCRETIONARY: readonly AidTraceStep[] = [
  ...TRACE_CAPPED_BY_ASK.slice(0, -1),
  total('1500.00', null, { discretionary: '250.00' }),
]

/** An incentive that takes $100 off the award after the ask has limited it. */
export const TRACE_INCENTIVE_AWARD: readonly AidTraceStep[] = [
  ...income('120000.00', 5),
  cost(),
  grants(),
  ...r1Steps({
    pct: '40.00',
    potential: '2000.00',
    minimum: '100.00',
    r1: '1400.00',
    ask: '1500.00',
    potentialBound: 'table',
    r1Bound: 'ask',
    r1Note: 'Reduced by an incentive of 100.00',
  }),
  total('1400.00', null),
]

/** An incentive that takes $100 off the cost the percentage is worked from. */
export const TRACE_INCENTIVE_COST: readonly AidTraceStep[] = [
  ...income('120000.00', 5),
  cost('4900.00', '100.00'),
  grants(),
  ...r1Steps({
    pct: '40.00',
    potential: '1960.00',
    minimum: '100.00',
    cost: '4900.00',
    r1: '1960.00',
    ask: '3000.00',
    potentialBound: 'table',
    r1Bound: 'table',
  }),
  total('1960.00', null),
]

/** The total-aid cap cuts Round 2 from $1,000 to $700 (engine.py `retrace`). */
export const TRACE_TOTAL_CAP: readonly AidTraceStep[] = [
  ...TRACE_ROUND2_CAPPED.slice(0, -3),
  step(
    'r2_cap',
    'Round 2 cap',
    '1000.00',
    {
      total_pct: '90.00',
      cost: '5000.00',
      r1: '3500.00',
      grants_subtracted: false,
      grants_since_round1: '0.00',
    },
    'cap'
  ),
  step(
    'r2',
    'Round 2 award',
    '700.00',
    { appeal: '2500.00', cap: '1000.00', before_total_cap: '1000.00' },
    'total_cap',
    'Cut to fit the total-aid cap'
  ),
  step('total_cap', 'Total-aid cap', '4200.00', {
    pct_of_cost: '84.00',
    include_grants: false,
    r2_before: '1000.00',
    r2_after: '700.00',
    r3_before: null,
    r3_after: null,
  }),
  total('3500.00', '700.00'),
]

/**
 * Traces from the real calculator (calculate() over the invented test rules), kept as emitted:
 * Decimals as strings, no hand-built inputs. They pin what the receipt says beside what the
 * engine did.
 */
export const REAL_INCENTIVE_CLAMPED: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '250000.0',
    inputs: {
      prior_year: '250000',
      current_year: '250000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '250000',
    inputs: { base: '250000.0', after_dependents: '250000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 6,
    inputs: { adjusted_income: '250000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 6,
    inputs: { income_tier: 6, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '2000',
    inputs: { source: 'catalog', resolved: '2000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '0',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '2',
    inputs: { table: 'camp', tier: 6, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '100',
    inputs: { pct: '2', cost: '2000', grants: '0', minimum: '100', minimum_uncapped: '100' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '0',
    inputs: { ask: '4000', potential: '100' },
    bound: 'minimum',
    note: 'Reduced by an incentive of 150',
  },
  {
    key: 'total',
    label: 'Total award',
    value: '0',
    inputs: { r1: '0', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_INCENTIVE_ASK: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '60000.0',
    inputs: {
      prior_year: '60000',
      current_year: '60000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '60000',
    inputs: { base: '60000.0', after_dependents: '60000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 2,
    inputs: { adjusted_income: '60000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 2,
    inputs: { income_tier: 2, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '4000',
    inputs: { source: 'catalog', resolved: '4000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '0',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '75',
    inputs: { table: 'camp', tier: 2, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '3000',
    inputs: { pct: '75', cost: '4000', grants: '0', minimum: '100', minimum_uncapped: '100' },
    bound: 'table',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '1400',
    inputs: { ask: '1500', potential: '3000' },
    bound: 'ask',
    note: 'Reduced by an incentive of 100',
  },
  {
    key: 'total',
    label: 'Total award',
    value: '1400',
    inputs: { r1: '1400', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_REDUCE_COST_BASIS: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '100000.0',
    inputs: {
      prior_year: '100000',
      current_year: '100000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '100000',
    inputs: { base: '100000.0', after_dependents: '100000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 3,
    inputs: { adjusted_income: '100000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 3,
    inputs: { income_tier: 3, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '4000',
    inputs: { source: 'catalog', resolved: '4000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '500',
    inputs: { count_when: 'committed', offset_mode: 'reduce_cost_basis', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '55',
    inputs: { table: 'camp', tier: 3, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '1925',
    inputs: { pct: '55', cost: '4000', grants: '500', minimum: '100', minimum_uncapped: '100' },
    bound: 'table',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '1925',
    inputs: { ask: '4000', potential: '1925' },
    bound: 'table',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '1925',
    inputs: { r1: '1925', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_GRANTS_COVER_NO_MINIMUM: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '60000.0',
    inputs: {
      prior_year: '60000',
      current_year: '60000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '60000',
    inputs: { base: '60000.0', after_dependents: '60000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 2,
    inputs: { adjusted_income: '60000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 2,
    inputs: { income_tier: 2, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '4000',
    inputs: { source: 'catalog', resolved: '4000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '5000',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '75',
    inputs: { table: 'camp', tier: 2, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '0',
    inputs: { pct: '75', cost: '4000', grants: '5000', minimum: '100', minimum_uncapped: '100' },
    bound: 'grants_cover',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '0',
    inputs: { ask: '4000', potential: '0' },
    bound: 'grants_cover',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '0',
    inputs: { r1: '0', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_MINIMUM_LESS_GRANTS: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '250000.0',
    inputs: {
      prior_year: '250000',
      current_year: '250000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '250000',
    inputs: { base: '250000.0', after_dependents: '250000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 6,
    inputs: { adjusted_income: '250000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 6,
    inputs: { income_tier: 6, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '2000',
    inputs: { source: 'catalog', resolved: '2000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '60',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '2',
    inputs: { table: 'camp', tier: 6, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '40',
    inputs: { pct: '2', cost: '2000', grants: '60', minimum: '100', minimum_uncapped: '100' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '40',
    inputs: { ask: '4000', potential: '40' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '40',
    inputs: { r1: '40', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_COST_UNKNOWN_MINIMUM: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '60000.0',
    inputs: {
      prior_year: '60000',
      current_year: '60000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '60000',
    inputs: { base: '60000.0', after_dependents: '60000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 2,
    inputs: { adjusted_income: '60000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: {},
    bound: null,
    note: 'This program has no equity class',
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 2,
    inputs: { income_tier: 2, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: null,
    inputs: { source: 'unknown', resolved: null, incentive_reduction: '0' },
    bound: null,
    note: 'this program has no price; staff must type the cost',
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '0',
    inputs: {},
    bound: null,
    note: "Grants do not offset 'family_school' this season",
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '0',
    inputs: { table: null, tier: 2, source: 'no_table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '100',
    inputs: { pct: '0', cost: null, grants: '0', minimum: '100', minimum_uncapped: '100' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '100',
    inputs: { ask: '4000', potential: '100' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '100',
    inputs: { r1: '100', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]

export const REAL_ROUND2_CAP_NEGATIVE: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '60000.0',
    inputs: {
      prior_year: '60000',
      current_year: '60000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '60000',
    inputs: { base: '60000.0', after_dependents: '60000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 2,
    inputs: { adjusted_income: '60000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 2,
    inputs: { income_tier: 2, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '4000',
    inputs: { source: 'catalog', resolved: '4000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '0',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '75',
    inputs: { table: 'camp', tier: 2, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '3000',
    inputs: { pct: '75', cost: '4000', grants: '0', minimum: '100', minimum_uncapped: '100' },
    bound: 'table',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '3000',
    inputs: { ask: '4000', potential: '3000' },
    bound: 'table',
    note: null,
  },
  {
    key: 'r1_locked',
    label: 'Round 1 as posted',
    value: '3700',
    inputs: { worked_out: '3000' },
    bound: 'locked',
    note: 'Locked when it was posted; later rounds build on this amount',
  },
  {
    key: 'r2_cap',
    label: 'Round 2 cap',
    value: '-100',
    inputs: {
      total_pct: '90',
      cost: '4000',
      r1: '3700',
      grants_subtracted: false,
      grants_since_round1: '0',
    },
    bound: 'cap',
    note: null,
  },
  {
    key: 'r2',
    label: 'Round 2 award',
    value: '0',
    inputs: { appeal: '500', cap: '-100' },
    bound: 'cap',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '3700',
    inputs: { r1: '3700', r2: '0', r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]
/** The minimum ($100) capped at what the family still owes ($50) after $1,950 of grants. */
export const REAL_MINIMUM_CAPPED_AT_SHARE: readonly AidTraceStep[] = [
  {
    key: 'weighted_income',
    label: 'Weighted income',
    value: '250000.0',
    inputs: {
      prior_year: '250000',
      current_year: '250000',
      weight_prior: '0.7',
      weight_current: '0.3',
      basis: 'gross',
      override_mode: null,
    },
    bound: null,
    note: null,
  },
  {
    key: 'income_adjustments',
    label: 'Income adjustments',
    value: '0',
    inputs: {
      medical_excess: '0',
      education_excess: '0',
      savings_excess: '0',
      extra_terms: '0',
      dependent_reduction: '0',
    },
    bound: null,
    note: null,
  },
  {
    key: 'adjusted_income',
    label: 'Adjusted household income',
    value: '250000',
    inputs: { base: '250000.0', after_dependents: '250000.0', floor: '0' },
    bound: null,
    note: 'floor tested after all reductions',
  },
  {
    key: 'income_tier',
    label: 'Income tier',
    value: 6,
    inputs: { adjusted_income: '250000' },
    bound: null,
    note: null,
  },
  {
    key: 'equity_shift',
    label: 'Equity shift',
    value: 0,
    inputs: { equity_class: 'camp', criteria_met: '', weight_sum: '0', aggregation: 'ceil' },
    bound: null,
    note: null,
  },
  {
    key: 'final_tier',
    label: 'Final tier',
    value: 6,
    inputs: { income_tier: 6, equity_shift: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'cost',
    label: 'Cost',
    value: '2000',
    inputs: { source: 'catalog', resolved: '2000', incentive_reduction: '0' },
    bound: null,
    note: null,
  },
  {
    key: 'grants',
    label: 'Outside grants',
    value: '1950',
    inputs: { count_when: 'committed', offset_mode: 'dollar', late_left_out: 0 },
    bound: null,
    note: null,
  },
  {
    key: 'r1_pct',
    label: 'Round 1 percentage',
    value: '2',
    inputs: { table: 'camp', tier: 6, source: 'table' },
    bound: null,
    note: null,
  },
  {
    key: 'r1_potential',
    label: 'Round 1 potential',
    value: '50',
    inputs: { pct: '2', cost: '2000', grants: '1950', minimum: '50', minimum_uncapped: '100' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'r1',
    label: 'Round 1 award',
    value: '50',
    inputs: { ask: '4000', potential: '50' },
    bound: 'minimum',
    note: null,
  },
  {
    key: 'total',
    label: 'Total award',
    value: '50',
    inputs: { r1: '50', r2: null, r3: null, top_up: '0', discretionary: '0' },
    bound: null,
    note: null,
  },
]
