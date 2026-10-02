/**
 * Scenario fixtures (slice 2): an invented 2027 workspace in the server's shape (`WorkspaceOut`):
 * a frozen snapshot, starting points A and B with A's variant A1, and Test User's draft from B.
 * by_tier leaves the held requests out, as the server's tier rows do (195+146+70 = 411 of 420, 9 held).
 * Every figure is invented; pools are "Pool A" and "Pool B".
 */
import type {
  ApiAidCommittee,
  ApiAidCompareColumn,
  ApiAidScenarioCompare,
  ApiAidScenarioDraft,
  ApiAidScenarioOption,
  ApiAidScenarioResults,
  ApiAidScenarioTrailPage,
  ApiAidScenarioWorkspace,
} from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'

export function results(
  round1: number,
  over: Partial<ApiAidScenarioResults> = {}
): ApiAidScenarioResults {
  return {
    requests: 420,
    families: 380,
    round1,
    round2: 20500,
    round3: 950,
    round1_allocated: 800000,
    round1_remaining: 800000 - round1,
    remaining: 1000000 - round1 - 20500 - 950,
    at_minimum: 12,
    held: 9,
    held_asked: 18900,
    round1_unmet: 50920,
    pools: [
      {
        pool: 'pool_a',
        label: 'Pool A',
        round1: round1 - 50000,
        round2: 20500,
        round3: 950,
        round1_allocated: 720000,
        round1_remaining: 720000 - (round1 - 50000),
        remaining: 900000 - (round1 - 50000) - 21450,
        round1_unmet: 46620,
      },
      {
        pool: 'pool_b',
        label: 'Pool B',
        round1: 50000,
        round2: 0,
        round3: 0,
        round1_allocated: 80000,
        round1_remaining: 30000,
        remaining: 50000,
        round1_unmet: 4300,
      },
    ],
    by_tier: [
      { tier: 1, requests: 195, families: 176, round1: round1 - 200000 },
      { tier: 2, requests: 146, families: 136, round1: 150000 },
      { tier: 3, requests: 70, families: 60, round1: 50000 },
    ],
    not_in_tiers: 0,
    request_set: null,
    round2_allocated: 60000,
    round2_remaining: 39500,
    ...over,
  }
}

function option(
  code: string,
  startingPoint: string | null,
  label: string,
  round1: number
): ApiAidScenarioOption {
  return {
    code,
    starting_point: startingPoint,
    from_code: startingPoint,
    origin_version: 4,
    label,
    kept_by: 'Test User',
    kept_at: '2027-01-14T17:40:00Z',
    results: results(round1),
    stale: false,
  }
}

export const OPTIONS: readonly ApiAidScenarioOption[] = [
  option('A', null, 'rules draft v4 as they were', 780000),
  option('A1', 'A', 'Round 1 % −2 pts', 760000),
  option('B', null, 'bands $5,000 wider', 740000),
]

export function scenarioDraft(over: Partial<ApiAidScenarioDraft> = {}): ApiAidScenarioDraft {
  return {
    trail_id: 'trail0000000001',
    from_code: 'B',
    // Like the server's, the label and changes compare the draft with its source option (B).
    label: 'Round 1 % −5 pts',
    document: RULES_DOCUMENT,
    changes: [
      {
        path: ['award_tables', 'general', 'tiers', '1', 'r1_pct'],
        kind: 'changed',
        before: '95',
        after: '90',
      },
      {
        path: ['award_tables', 'general', 'tiers', '2', 'r1_pct'],
        kind: 'changed',
        before: '65',
        after: '60',
      },
      {
        path: ['award_tables', 'general', 'tiers', '3', 'r1_pct'],
        kind: 'changed',
        before: '25',
        after: '20',
      },
    ],
    results: results(735000),
    report: { issues: [] },
    recorded_at: '2027-01-15T17:03:00Z',
    ...over,
  }
}

export function workspace(over: Partial<ApiAidScenarioWorkspace> = {}): ApiAidScenarioWorkspace {
  return {
    year: 2027,
    rules_version: 4,
    pricing_version: 3,
    snapshot: {
      id: 'snap00000000001',
      taken_at: '2027-01-12T18:00:00Z',
      taken_by: 'Test User',
      requests: 420,
      awaiting_rules: 0,
    },
    draft: scenarioDraft(),
    options: [...OPTIONS],
    ...over,
  }
}

function committee(round1: number): ApiAidCommittee {
  return {
    budget_total: 1000000,
    round1,
    round1_pct_of_budget: Math.round((round1 / 1000000) * 1000) / 10,
    round2: 20500,
    round1_by_tier: [
      {
        table: 'general',
        tier: 1,
        requests: 200,
        families: 180,
        asked: 500000,
        average_ask: 2500,
        fee_pct: 90,
        pct_of_ask: 70,
        round1: 350000,
        average_round1: 1750,
        held: 3,
        held_asked: 6000,
        no_ask: 0,
      },
      {
        table: null,
        tier: 1,
        requests: 200,
        families: 180,
        asked: 500000,
        average_ask: 2500,
        fee_pct: null,
        pct_of_ask: 70,
        round1: 350000,
        average_round1: 1750,
        held: 3,
        held_asked: 6000,
        no_ask: 0,
      },
      {
        table: null,
        tier: 2,
        requests: 150,
        families: 140,
        asked: 300000,
        average_ask: 2000,
        fee_pct: null,
        pct_of_ask: 61.2,
        round1: round1 - 350000,
        average_round1: 1000,
        held: 1,
        held_asked: 1500,
        no_ask: 2,
      },
    ],
    round2_by_tier: [
      {
        table: null,
        tier: 1,
        appeals: 20,
        asked: 30000,
        max_pct: null,
        priced: 18,
        priced_asked: 28000,
        round2: 20500,
        average_round2: 1139,
        pct_of_ask: 73.2,
        held_asked: 2000,
      },
    ],
    not_in_tiers: 0,
    round2_not_in_tiers: 0,
  }
}

function column(
  code: string,
  label: string,
  round1: number,
  over: Partial<ApiAidCompareColumn> = {}
): ApiAidCompareColumn {
  return {
    code,
    label,
    document: RULES_DOCUMENT,
    changes: [],
    results: results(round1),
    up: 12,
    down: 3,
    committee: committee(round1),
    ...over,
  }
}

/** The draft beside A1; the draft's minimum changed against its reference. */
export function compareOut(over: Partial<ApiAidScenarioCompare> = {}): ApiAidScenarioCompare {
  return {
    year: 2027,
    snapshot: {
      id: 'snap00000000001',
      taken_at: '2027-01-12T18:00:00Z',
      taken_by: 'Test User',
      requests: 420,
      awaiting_rules: 0,
    },
    columns: [
      column('draft', 'from B: minimum $150', 735000, {
        document: { ...RULES_DOCUMENT, awards: { ...RULES_DOCUMENT.awards, minimum: '150' } },
        changes: [{ path: ['awards', 'minimum'], kind: 'changed', before: '100', after: '150' }],
      }),
      column('A1', 'Round 1 % −2 pts', 760000, { up: 0, down: 40 }),
    ],
    last_season: {
      year: 2026,
      loaded: true,
      label: '2026 as posted',
      rules_version: 7,
      view: committee(649247),
    },
    ...over,
  }
}

export const TRAIL: ApiAidScenarioTrailPage = {
  page: 1,
  per_page: 50,
  total: 2,
  rows: [
    {
      id: 'trail0000000002',
      recorded_at: '2027-01-15T17:03:00Z',
      actor: 'Test User',
      from_code: 'B',
      change: 'shift every tier 0 pts → −5 pts',
      kept_code: null,
      round1: 735000,
      round1_remaining: 65000,
      at_minimum: 12,
      stale: false,
    },
    {
      id: 'trail0000000001',
      recorded_at: '2027-01-14T17:20:00Z',
      actor: 'Test User',
      from_code: 'A',
      change: 'band width $24k → $29k',
      kept_code: 'B',
      round1: 740000,
      round1_remaining: 60000,
      at_minimum: 10,
      stale: true,
    },
  ],
}
