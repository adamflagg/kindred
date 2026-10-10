import type {
  ApiAidBudget,
  ApiAidBudgetCell,
  ApiAidBudgetPool,
  ApiAidToday,
  ApiAidTodayLine,
} from '../../../types/api-types'

export const line = (
  key: ApiAidTodayLine['key'],
  items: number,
  over: Partial<ApiAidTodayLine> = {}
): ApiAidTodayLine => ({
  key,
  families: items,
  items,
  item_kind: 'requests',
  reasons: [],
  amount: null,
  oldest_days: null,
  over_14_days: null,
  largest_gap: null,
  request_ids: [],
  skipped: '',
  overdue: false,
  next_up: [],
  names: [],
  ...over,
})

export const STAGES = {
  accepted: 318,
  waiting_on_family: 9,
  pending_approval: 6,
  needs_offer: 31,
  held: 6,
  cancelled: 42,
  families: 389,
  posted_this_week: 14,
}

export const REGISTRAR_TODAY: ApiAidToday = {
  year: 2027,
  finance: null,
  development: null,
  stages: STAGES,
  casework: [
    line('needs_offer', 31, {
      families: 23,
      oldest_days: 12,
      overdue: true,
      next_up: [
        {
          household_cm_id: 1000002,
          label: 'Garcia',
          tiebreak: '',
          days: 12,
          camper_name: 'Liam Garcia',
          session_name: 'Session 2',
          session_type: 'main',
          round: 1,
          ask: 1850,
        },
        {
          household_cm_id: 1000003,
          label: 'Chen',
          tiebreak: '',
          days: 11,
          camper_name: 'Olivia Chen',
          session_name: 'Session 3',
          session_type: 'main',
          round: 1,
          ask: 2400,
        },
      ],
    }),
    line('holds', 6),
    line('waiting_on_family', 9, { oldest_days: 19, overdue: true }),
    line('not_reconciled', 8),
    line('to_reverse', 1),
    line('session_not_settled', 2),
    line('duplicates', 0),
    line('to_place', 3, { item_kind: 'lines' }),
    line('grants', 4, { item_kind: 'grants' }),
    line('late_full_coverage', 1),
  ],
}

const cell = (o: Partial<ApiAidBudgetCell>): ApiAidBudgetCell => ({
  posted: 0,
  accepted: 0,
  needs_offer: 0,
  pending_approval: 0,
  needs_offer_count: null,
  pending_approval_count: null,
  unconfirmed: null,
  committed: null,
  allocated: null,
  remaining: null,
  ...o,
})
const below = (held_asked: number) => ({
  held: null,
  held_asked,
  outside_grants: null,
  outside_budget: null,
  outside_budget_posted: null,
})
const pool = (
  p: string,
  label: string,
  allocated: number | null,
  posted: number,
  offer: number,
  pend: number,
  held: number
): ApiAidBudgetPool => ({
  pool: p,
  label,
  rounds: [],
  decision_types: [],
  share_pct: null,
  total: cell({
    posted,
    needs_offer: offer,
    pending_approval: pend,
    allocated,
    remaining: allocated === null ? null : allocated - posted - offer - pend,
    committed: posted + offer + pend,
  }),
  below: below(held),
  demand: { round2_asks: null, round2_asked: null, round2_computed: null, round1_unmet: null },
})
export const BUDGET: ApiAidBudget = {
  year: 2027,
  rules_version: 3,
  strip: [],
  outside_grants_off_requests: null,
  not_rebuilt: [],
  pools: [
    pool('camp_quest', 'Camp & Quest', 972125, 761200, 113145, 9900, 8400),
    pool('tbm', 'TBM', 60000, 46300, 12000, 3000, 0),
    pool('weekend', 'Weekend programs', 79000, 35880, 650, 1920, 1200),
  ],
  total: pool('total', 'All pools', 1111125, 843380, 125795, 14820, 9600),
}
