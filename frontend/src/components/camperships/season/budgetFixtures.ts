/**
 * Rounds & budget fixtures (slice 2): an invented 2027 season in the shape of `BudgetResponse`,
 * including the reads #2952 added (per-cell counts, the unconfirmed line, per-decision-type lines,
 * forward-demand counts, the strip's awaiting-sync and not-reconciled counts). Pools "Pool A" and
 * "Pool B" (tests/CLAUDE.md's generic pools), one "No pool" line, and the total. Every figure is
 * invented, and each pool's Remaining is its Allocated − Posted − Needs an offer − Pending
 * approval to the cent (§5.3), so a test that sums them sees the server's sums.
 */
import type {
  ApiAidBudget,
  ApiAidBudgetCell,
  ApiAidBudgetPool,
  ApiAidCount,
  ApiAidDecisionTypeLine,
} from '../../../types/api-types'

const count = (families: number, requests: number): ApiAidCount => ({ families, requests })

function cell(
  allocated: number | null,
  posted: number,
  accepted: number,
  needs: number,
  pending: number,
  extra: Partial<ApiAidBudgetCell> = {}
): ApiAidBudgetCell {
  return {
    allocated,
    posted,
    accepted,
    needs_offer: needs,
    pending_approval: pending,
    remaining: allocated === null ? null : allocated - posted - needs - pending,
    // A live cell always carries both counts, at least {0, 0} (the server's `_cell`).
    needs_offer_count: count(0, 0),
    pending_approval_count: count(0, 0),
    ...extra,
  }
}

/** Money on a round with no named decision type: the server's key-null line (budget.py). */
const NO_TYPE_LINE: ApiAidDecisionTypeLine = {
  key: null,
  label: 'No named decision type',
  counts_toward_budget: true,
  amount: 1200,
  posted: 1200,
  own: 0,
  requests: count(1, 1),
}

const POOL_A: ApiAidBudgetPool = {
  pool: 'pool_a',
  label: 'Pool A',
  rounds: [
    {
      round: 1,
      ...cell(800000, 764540, 598300, 8100, 0, {
        needs_offer_count: count(3, 3),
        pending_approval_count: count(0, 0),
        unconfirmed: { count: 4, families: 4, amount: 5200 },
      }),
    },
    {
      round: 2,
      ...cell(110000, 14200, 9800, 5520, 0, {
        needs_offer_count: count(8, 8),
        pending_approval_count: count(0, 0),
        unconfirmed: { count: 2, families: 2, amount: 1800 },
      }),
    },
    {
      round: 3,
      ...cell(40000, 1800, 900, 300, 650, {
        needs_offer_count: count(2, 2),
        pending_approval_count: count(1, 1),
      }),
    },
  ],
  total: cell(950000, 780540, 609000, 13920, 650, {
    needs_offer_count: count(13, 13),
    pending_approval_count: count(1, 1),
    unconfirmed: { count: 6, families: 6, amount: 7000 },
  }),
  below: {
    held: count(6, 9),
    held_asked: 18900,
    outside_grants: 41200,
    outside_budget: 21840,
    outside_budget_posted: 21840,
    outside_grants_requests: count(12, 14),
  },
  demand: {
    round2_asks: count(30, 31),
    round2_asked: 33000,
    round2_computed: 20500,
    round1_unmet: 50920,
    round1_unmet_requests: count(40, 44),
    round2_held: count(2, 2),
    round2_held_asked: 2600,
    round1_held: count(4, 7),
    round1_held_asked: 16300,
  },
  decision_types: [
    {
      key: 'standard',
      label: 'Standard award',
      counts_toward_budget: true,
      amount: 700110,
      posted: 685000,
      own: 685000,
      requests: count(300, 320),
    },
    {
      key: 'appeal',
      label: 'Appeal',
      counts_toward_budget: true,
      amount: 95000,
      posted: 95540,
      own: 95540,
      requests: count(40, 44),
    },
    {
      key: 'outside',
      label: 'Funded outside the budget',
      counts_toward_budget: false,
      amount: 21840,
      posted: 21840,
      own: 0,
      requests: count(9, 10),
    },
  ],
}

const POOL_B: ApiAidBudgetPool = {
  pool: 'pool_b',
  label: 'Pool B',
  rounds: [
    {
      round: 1,
      ...cell(93600, 52400, 40000, 0, 0, {
        needs_offer_count: count(0, 0),
        pending_approval_count: count(0, 0),
      }),
    },
    { round: 2, ...cell(0, 0, 0, 0, 0) },
    { round: 3, ...cell(0, 0, 0, 0, 0) },
  ],
  total: cell(93600, 52400, 40000, 0, 0),
  below: {
    held: count(1, 1),
    held_asked: 2000,
    outside_grants: 3100,
    outside_budget: 0,
    outside_budget_posted: 0,
    outside_grants_requests: count(2, 2),
  },
  demand: {
    round2_asks: count(2, 2),
    round2_asked: 1700,
    round2_computed: 1200,
    round1_unmet: 4300,
    round1_unmet_requests: count(3, 3),
    round2_held: count(0, 0),
    round2_held_asked: 0,
    round1_held: count(1, 1),
    round1_held_asked: 2000,
  },
  decision_types: [
    {
      key: 'standard',
      label: 'Standard award',
      counts_toward_budget: true,
      amount: 52400,
      posted: 52400,
      own: 52400,
      requests: count(24, 25),
    },
  ],
}

/** Money on a program the rules give no pool: counted in the total only, with no allocation. */
const NO_POOL: ApiAidBudgetPool = {
  pool: '',
  label: 'No pool',
  rounds: [
    { round: 1, ...cell(null, 1200, 0, 0, 0) },
    { round: 2, ...cell(null, 0, 0, 0, 0) },
    { round: 3, ...cell(null, 0, 0, 0, 0) },
  ],
  total: cell(null, 1200, 0, 0, 0),
  below: {
    held: count(0, 0),
    held_asked: 0,
    outside_grants: 0,
    outside_budget: 0,
    outside_budget_posted: 0,
    outside_grants_requests: count(0, 0),
  },
  demand: {
    round2_asks: count(0, 0),
    round2_asked: 0,
    round2_computed: 0,
    round1_unmet: 0,
    round1_unmet_requests: count(0, 0),
    round2_held: count(0, 0),
    round2_held_asked: 0,
    round1_held: count(0, 0),
    round1_held_asked: 0,
  },
  decision_types: [NO_TYPE_LINE],
}

const TOTAL: ApiAidBudgetPool = {
  pool: '*',
  label: 'Total',
  rounds: [
    {
      round: 1,
      ...cell(893600, 818140, 638300, 8100, 0, {
        needs_offer_count: count(3, 3),
        pending_approval_count: count(0, 0),
        unconfirmed: { count: 4, families: 4, amount: 5200 },
      }),
    },
    {
      round: 2,
      ...cell(110000, 14200, 9800, 5520, 0, {
        needs_offer_count: count(8, 8),
        pending_approval_count: count(0, 0),
        unconfirmed: { count: 2, families: 2, amount: 1800 },
      }),
    },
    {
      round: 3,
      ...cell(40000, 1800, 900, 300, 650, {
        needs_offer_count: count(2, 2),
        pending_approval_count: count(1, 1),
      }),
    },
  ],
  total: cell(1043600, 834140, 649000, 13920, 650, {
    needs_offer_count: count(13, 13),
    pending_approval_count: count(1, 1),
    unconfirmed: { count: 6, families: 6, amount: 7000 },
  }),
  below: {
    held: count(7, 10),
    held_asked: 20900,
    outside_grants: 44300,
    outside_budget: 21840,
    outside_budget_posted: 21840,
    outside_grants_requests: count(14, 16),
  },
  demand: {
    round2_asks: count(32, 33),
    round2_asked: 34700,
    round2_computed: 21700,
    round1_unmet: 55220,
    round1_unmet_requests: count(43, 47),
    round2_held: count(2, 2),
    round2_held_asked: 2600,
    round1_held: count(5, 8),
    round1_held_asked: 18300,
  },
  // Merged by key (and in/out of the budget) from the pools' lines; counts are plausible merges.
  decision_types: [
    {
      key: 'standard',
      label: 'Standard award',
      counts_toward_budget: true,
      amount: 752510,
      posted: 737400,
      own: 737400,
      requests: count(324, 345),
    },
    {
      key: 'appeal',
      label: 'Appeal',
      counts_toward_budget: true,
      amount: 95000,
      posted: 95540,
      own: 95540,
      requests: count(40, 44),
    },
    {
      key: 'outside',
      label: 'Funded outside the budget',
      counts_toward_budget: false,
      amount: 21840,
      posted: 21840,
      own: 0,
      requests: count(9, 10),
    },
    NO_TYPE_LINE,
  ],
}

export const BUDGET: ApiAidBudget = {
  year: 2027,
  rules_version: 3,
  pools: [POOL_A, POOL_B, NO_POOL],
  total: TOTAL,
  strip: [
    {
      round: 1,
      needs_offer: count(3, 3),
      posted: count(340, 367),
      accepted: count(310, 330),
      held: count(6, 9),
      pending_approval: count(0, 0),
      awaiting_sync: count(4, 4),
      not_reconciled: count(2, 2),
    },
    {
      round: 2,
      needs_offer: count(8, 8),
      posted: count(22, 23),
      accepted: count(15, 15),
      held: count(2, 2),
      pending_approval: count(0, 0),
      awaiting_sync: count(1, 1),
      not_reconciled: count(0, 0),
    },
    {
      round: 3,
      needs_offer: count(2, 2),
      posted: count(6, 6),
      accepted: count(3, 3),
      held: count(0, 0),
      pending_approval: count(1, 1),
      awaiting_sync: count(0, 0),
      not_reconciled: count(0, 0),
    },
  ],
  outside_grants_off_requests: 5400,
}

/**
 * The same season read as of a past day (3c): what the server leaves empty there is null
 * (`past_budget`): Needs an offer, Pending approval, Remaining (with the counts that go with the
 * first two), the unconfirmed line, the held counts, and the strip's needs-an-offer, held and
 * pending counts.
 */
export function pastBudget(): ApiAidBudget {
  const pastCell = (c: ApiAidBudgetCell): ApiAidBudgetCell => ({
    ...c,
    needs_offer: null,
    pending_approval: null,
    remaining: null,
    needs_offer_count: null,
    pending_approval_count: null,
    unconfirmed: null,
  })
  const pastPool = (p: ApiAidBudgetPool): ApiAidBudgetPool => ({
    ...p,
    rounds: p.rounds.map((r) => ({ ...r, ...pastCell(r) })),
    total: pastCell(p.total),
    below: {
      ...p.below,
      held: null,
      held_asked: null,
      outside_grants: null,
      outside_budget: null,
      outside_grants_requests: null,
    },
    // The server nulls amount, own and requests on every line (`_past_pool`), posted stays.
    decision_types: (p.decision_types ?? []).map((t) => ({
      ...t,
      amount: null,
      own: null,
      requests: null,
    })),
    demand: {
      ...p.demand,
      round2_computed: null,
      round1_unmet: null,
      round1_unmet_requests: null,
      round2_held: null,
      round2_held_asked: null,
      round1_held: null,
      round1_held_asked: null,
    },
  })
  return {
    ...BUDGET,
    pools: BUDGET.pools.map(pastPool),
    total: pastPool(BUDGET.total),
    strip: BUDGET.strip.map((row) => ({
      ...row,
      needs_offer: null,
      held: null,
      pending_approval: null,
    })),
    outside_grants_off_requests: null,
    as_of: '2027-03-15',
    as_of_axis: 'campminder',
    not_rebuilt: [{ figure: 'needs_offer', reason: 'Priced from the answers as they stood then' }],
  }
}
