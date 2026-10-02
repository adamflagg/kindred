/**
 * Scenario fixtures (slice 2): an invented 2027 workspace in the server's shape (`WorkspaceOut`):
 * a frozen snapshot, starting points A and B with A's variant A1, and Test User's draft from B.
 * Every figure is invented; pools are "Pool A" and "Pool B".
 */
import type {
  ApiAidScenarioDraft,
  ApiAidScenarioOption,
  ApiAidScenarioResults,
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
      { tier: 1, requests: 200, families: 180, round1: round1 - 200000 },
      { tier: 2, requests: 150, families: 140, round1: 150000 },
      { tier: 3, requests: 70, families: 60, round1: 50000 },
    ],
    not_in_tiers: 0,
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
    label: 'bands $5,000 wider · Round 1 % −5 pts',
    document: RULES_DOCUMENT,
    changes: [],
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
