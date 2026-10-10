/**
 * Forward demand below the line (spec §5.9, §7.2; D82; budget-demand.html E): per pool, Round 2
 * asks so far and Round 1 unmet ask, not yet appealed, each with the held asks the read counts
 * separately. Shown, never counted in Remaining. Pure: the server sums every figure
 * (`ForwardDemandOut`, budget.py `_tally_demand`); this only lays them out.
 */
import type { ApiAidBudget, ApiAidBudgetPool, ApiAidCount } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { formatWholeMoney } from '../kit/money'
import { countWords } from '../requests/views'
import { NO_POOL, opensQueueViews } from './budgetModel'

/**
 * Demand's money reads in whole dollars, as every other figure on the page (rounds-17: the real 2026 Round 1 unmet ask
 * read $3,566,095.61). The server keeps the cents; the screen doesn't show them.
 */
export const demandMoney = formatWholeMoney

/**
 * The rows' own definitions, as titles (the final design moves the old notes 8 and 9 here; the six notes are
 * Allocated … Below the line). Every ask counts at the D91 need cap (owner Q12, 2026-10-10): at most the request's
 * session cost less the awards posted before that round, as Statistics' Asked does since #3122.
 */
export const DEMAND_TITLES = {
  round2_asks:
    "Round 2 asks so far: the appeals keyed so far on live requests (not cancelled, withdrawn or a duplicate), counted, with their total ask, held appeals' asks included, and the total computed for those decided or posted. Each ask counts at most the session's cost less the Round 1 award posted. It knows only the appeals keyed so far. Shown below the line, never counted in Remaining.",
  round1_unmet:
    "Round 1 unmet ask, not yet appealed: Σ (the family's Round 1 ask, at most the session's cost, − its Round 1 decided award) over live requests with no Round 2 ask keyed yet, plus held Round 1 requests' asks, per pool. It is demand that can still come back as appeals: shown below the line, never counted in Remaining. Rounds outside the budget don't count, offers that were clawed back don't count, and each family's gap is floored at $0, so one family's overage never offsets another's unmet ask.",
} as const

export interface DemandLine {
  /** The row's kind; its note is the sixth, Below the line. */
  readonly key: 'round2_asks' | 'round1_unmet'
  readonly label: string
  /** The row's definition, for its title attribute. */
  readonly title: string
  /** The requests the line counts (the server's `round2_asks` / `round1_unmet_requests`). */
  readonly requests: ApiAidCount | null
  readonly asked: number | null
  readonly computed: number | null
  readonly unmet: number | null
  /** The held requests among them, and their asks: plain figures, no link. */
  readonly held: ApiAidCount | null
  readonly heldAsked: number | null
  readonly href: string | null
}

export interface DemandGroup {
  readonly pool: string
  readonly label: string
  readonly lines: readonly DemandLine[]
}

/** The Held · asked cell: "2 fam · 2 req · $2,600", or "—" where a past date leaves it empty. */
export function heldWords(line: DemandLine): string {
  return line.held === null ? '—' : `${countWords(line.held)} · ${demandMoney(line.heldAsked)}`
}

function groupOf(pool: ApiAidBudgetPool, view: AidView, onPool: boolean): DemandGroup {
  const demand = pool.demand
  const asks = demand.round2_asks
  // Appeals is a today view, refused on a past date (`opensQueueViews`); the No pool opens nothing.
  const opens = asks !== null && asks.requests > 0 && pool.pool !== NO_POOL && opensQueueViews(view)
  return {
    pool: pool.pool,
    label: pool.label,
    lines: [
      {
        key: 'round2_asks',
        label: 'Round 2 asks so far',
        title: DEMAND_TITLES.round2_asks,
        requests: asks,
        asked: demand.round2_asked,
        computed: demand.round2_computed,
        // Not asked − computed: Asked counts held appeals' asks and Computed leaves them out, so the
        // difference would mix the two (budget.py `_tally_demand`; plan Decision 9).
        unmet: null,
        held: demand.round2_held ?? null,
        heldAsked: demand.round2_held_asked ?? null,
        href: opens
          ? aidHref('/aid/requests', view, {
              // Appeals is a lens, not a stage (one URL scheme, owner ruling 2026-10-03).
              lens: 'appeals',
              ...(onPool ? { pool: pool.pool } : {}),
              // Only live requests ask (budget.py: `request.live`); owner ruling 2026-10-02, Decision 6(b).
              live: '1',
            })
          : null,
      },
      {
        key: 'round1_unmet',
        label: 'Round 1 unmet ask, not yet appealed',
        title: DEMAND_TITLES.round1_unmet,
        requests: demand.round1_unmet_requests ?? null,
        asked: null,
        computed: null,
        unmet: demand.round1_unmet,
        held: demand.round1_held ?? null,
        heldAsked: demand.round1_held_asked ?? null,
        // "No Round 2 ask keyed yet" is no grid filter, so these rows open nothing.
        href: null,
      },
    ],
  }
}

// Only a real zero is empty: a figure a past date masks (null) is unknown, so its line stays and reads "—".
const empty = (pool: ApiAidBudgetPool) =>
  pool.demand.round2_asks?.requests === 0 &&
  pool.demand.round1_unmet === 0 &&
  pool.demand.round2_asked === 0

/**
 * Each pool's demand in the server's order (one pool when the page is on it), then the total when
 * there is more than one pool. The No pool line shows only when it holds some demand.
 */
export function demandGroups(
  budget: ApiAidBudget,
  pool: string | null,
  view: AidView
): DemandGroup[] {
  if (pool !== null) {
    const one = budget.pools.find((p) => p.pool === pool)
    return one === undefined ? [] : [groupOf(one, view, true)]
  }
  const pools = budget.pools.filter((p) => p.pool !== NO_POOL || !empty(p))
  const groups = pools.map((p) => groupOf(p, view, true))
  return pools.length > 1 ? [...groups, groupOf(budget.total, view, false)] : groups
}
