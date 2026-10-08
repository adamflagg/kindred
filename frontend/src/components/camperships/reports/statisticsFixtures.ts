/**
 * Reports › Statistics fixtures (slice 4): an invented 2027 season in the shape of
 * `StatisticsResponse`. Award tables and pools carry invented labels ("Table A", "Pool A"), as the
 * owner's rule allows in fixtures; the screens read real labels from the server. Every figure is
 * invented, and each total is what the server would send (the screen never sums). Server words
 * (reason and pool labels, the % headers) are copied as the server sends them today.
 */
import type { ApiAidStatistics, ApiAidStatisticsRow } from '../../../types/api-types'

function tierRow(over: Partial<ApiAidStatisticsRow>): ApiAidStatisticsRow {
  return {
    tier: 1,
    income_from: 0,
    income_to: 40000,
    fee_pct: 90,
    apps: 0,
    cancelled: 0,
    asked: 0,
    asks: 0,
    average_ask: null,
    amount: 0,
    decided: 0,
    awarded: 0,
    awarded_count: 0,
    decided_count: 0,
    average_award: null,
    live_asked: 0,
    pct_of_ask: null,
    grants: 0,
    pct_of_ask_with_grants: null,
    ...over,
  }
}

export const TIER_1 = tierRow({
  tier: 1,
  income_from: 0,
  income_to: 40000,
  fee_pct: 90,
  apps: 12,
  cancelled: 1,
  asked: 36000,
  asks: 12,
  average_ask: 3000,
  amount: 27000,
  awarded: 27000,
  awarded_count: 10,
  average_award: 2700,
  live_asked: 33000,
  pct_of_ask: 81.8,
  grants: 1500,
  pct_of_ask_with_grants: 86.4,
})

export const TIER_2 = tierRow({
  tier: 2,
  income_from: 40001,
  income_to: null,
  fee_pct: 75,
  apps: 4,
  asked: 8000,
  asks: 3,
  average_ask: 2666.67,
  amount: 1500,
  awarded: 1500,
  awarded_count: 1,
  average_award: 1500,
  live_asked: 8000,
  pct_of_ask: 18.8,
  grants: 0,
  pct_of_ask_with_grants: 18.8,
})

export const STATISTICS_TOTAL = tierRow({
  tier: null,
  income_from: null,
  income_to: null,
  fee_pct: null,
  apps: 16,
  cancelled: 1,
  asked: 44000,
  asks: 15,
  average_ask: 2933.33,
  amount: 28500,
  awarded: 28500,
  awarded_count: 11,
  average_award: 2590.91,
  live_asked: 41000,
  pct_of_ask: 69.5,
  grants: 1500,
  pct_of_ask_with_grants: 73.2,
})

export const STATISTICS: ApiAidStatistics = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  figures_on: '2027-04-10',
  rules_version: 3,
  basis: 'posted',
  pct_of_ask_label: '% of ask',
  pct_of_ask_with_grants_label: '% of ask incl. grants',
  table: 'camp',
  round: 1,
  tables: [
    { key: 'camp', label: 'Table A' },
    { key: 'family', label: 'Table B' },
  ],
  rows: [TIER_1, TIER_2],
  total: STATISTICS_TOTAL,
  cancelled_applicants: 1,
  recipients_cancelled: [
    {
      reason: 'medical',
      reason_label: 'Medical',
      pool: 'pool_a',
      pool_label: 'Pool A',
      round: 1,
      requests: 2,
      posted: 3400,
    },
    {
      reason: 'withdrawn_in_kindred',
      reason_label: 'Withdrawn in the dashboard',
      pool: 'pool_b',
      pool_label: 'Pool B',
      round: 1,
      requests: 1,
      posted: 700,
    },
    {
      reason: 'duplicate_in_kindred',
      reason_label: 'Duplicate',
      pool: 'pool_a',
      pool_label: 'Pool A',
      round: 1,
      requests: 1,
      posted: 500,
    },
    {
      reason: 'not_recorded',
      reason_label: 'no reason recorded',
      pool: null,
      pool_label: 'No pool',
      round: 2,
      requests: 1,
      posted: 300,
    },
  ],
  tier_appeals: [
    {
      tier: 1,
      income_from: 0,
      income_to: 40000,
      round1_apps: 12,
      round1_fee_pct: 90,
      appeals: 4,
      round2_max_pct: 95,
      round3_awarded: 600,
      appeal_rate: 33.3,
    },
  ],
  outcomes: [
    {
      pool: 'pool_a',
      kind: 'pool',
      pool_label: 'Pool A',
      accepted: 9,
      accepted_amount: 24300,
      appealed: 3,
      appealed_asked: 2700,
      waiting: 1,
    },
    {
      pool: 'pool_b',
      kind: 'pool',
      pool_label: 'Pool B',
      accepted: 1,
      accepted_amount: 1500,
      appealed: 0,
      appealed_asked: 0,
      waiting: 0,
    },
    {
      pool: null,
      kind: 'headline',
      pool_label: 'All pools',
      accepted: 10,
      accepted_amount: 25800,
      appealed: 3,
      appealed_asked: 2700,
      waiting: 1,
    },
  ],
  request_set: null,
  not_rebuilt: [],
}

/** All award tables (RPT-10): the eligible fee % varies, so the server sends none. */
export const STATISTICS_ALL_TABLES: ApiAidStatistics = {
  ...STATISTICS,
  table: null,
  rows: [
    { ...TIER_1, fee_pct: null },
    { ...TIER_2, fee_pct: null },
  ],
}

/**
 * "Include not yet offered" (D130): `amount` is Posted plus decided; `awarded` stays Posted alone
 * (#2974) and `decided` is broken out. Both % labels name their numerator (the server's words).
 */
export const STATISTICS_DECIDED: ApiAidStatistics = {
  ...STATISTICS,
  basis: 'posted_and_decided',
  pct_of_ask_label: '% of ask (posted + decided)',
  pct_of_ask_with_grants_label: '% of ask incl. grants (posted + decided)',
  rows: [{ ...TIER_1, amount: 30000, decided: 3000, decided_count: 2, pct_of_ask: 90.9 }, TIER_2],
  total: {
    ...STATISTICS_TOTAL,
    amount: 31500,
    decided: 3000,
    decided_count: 2,
    pct_of_ask: 76.8,
  },
}

/** Requests received through Feb 1, 2027 (D138): every figure is labelled. */
export const STATISTICS_THROUGH: ApiAidStatistics = {
  ...STATISTICS,
  request_set: {
    basis: 'date',
    through: '2027-02-01',
    label: 'requests received through Feb 1, 2027',
    left_out: 4,
    unknown: 1,
  },
}

/** A past date: what the read can't rebuild is empty and named (D154). */
export const STATISTICS_PAST: ApiAidStatistics = {
  ...STATISTICS,
  as_of: '2027-03-08',
  as_of_axis: 'campminder',
  figures_on: '2027-03-08',
  not_rebuilt: [{ figure: 'grants', reason: 'Grants are read live only', requests: [] }],
}
