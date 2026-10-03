/**
 * Forward demand below the line (spec §5.9, §7.2; D82; budget-demand.html E): per pool, Round 2
 * asks so far and Round 1 unmet ask, not yet appealed, each with the held asks the read counts
 * separately. Shown, never counted in Remaining. Pure: the server sums every figure
 * (`ForwardDemandOut`, budget.py `_tally_demand`); this only lays them out.
 */
import type { ApiAidBudget, ApiAidBudgetPool, ApiAidCount } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { formatMoney } from '../kit/money'
import { countWords } from '../requests/views'
import { NO_POOL, opensQueueViews } from './budgetModel'

export interface DemandLine {
  /** The line's key in the definitions registry, for its note number. */
  readonly key: 'round2_asks' | 'round1_unmet'
  readonly label: string
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
  return line.held === null ? '—' : `${countWords(line.held)} · ${formatMoney(line.heldAsked)}`
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
