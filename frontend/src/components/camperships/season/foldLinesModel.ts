/** Rounds & budget's fold lines and their URL state (spec §5.2 F, G). Pure; the server did every sum. */
import type { ApiAidBudget, ApiAidBudgetPool, ApiAidRoundCounts } from '../../../types/api-types'
import { formatMoney } from '../kit/money'
import { demandMoney } from './demandModel'
import { scopePool } from './budgetModel'

export type FoldLineKey = 'stands' | 'below' | 'demand' | 'types'
export const lineKey = (key: FoldLineKey) => `lines:${key}`
/** Where each round stands starts open (owner, 10-09: "open actually by default"); the other three start closed. */
export const DEFAULT_OPEN_LINES: readonly string[] = [lineKey('stands')]

/** `?open=pool_a,lines:stands` (D15, replaced). Today's `?fold=` is ignored and dropped on the next write. */
export function parseOpenKeys(raw: string | null): ReadonlySet<string> {
  return new Set((raw ?? '').split(',').filter((key) => key !== ''))
}

/** What is open: the defaults until the first toggle writes `?open=`, which is then the whole state ("" = all closed). */
export function openKeys(raw: string | null, defaults: Iterable<string>): ReadonlySet<string> {
  return raw === null ? new Set(defaults) : parseOpenKeys(raw)
}

/** The next `?open=` value, the whole state: "" when everything is closed. */
export function toggleOpenKey(open: ReadonlySet<string>, key: string): string {
  const next = new Set(open)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return [...next].join(',')
}

export const HOW_SUMMARY =
  'counts when offered · each pool keeps its own Remaining · only the total is a cap'
/** The Budget heading's description (rounds-5): the rules version, then how they count. */
export const budgetDescription = (version: number | null) =>
  version === null ? HOW_SUMMARY : `rules v${String(version)} · ${HOW_SUMMARY}`

const req = (n: number) => `${String(n)} req`
const sum = (
  rows: readonly ApiAidRoundCounts[],
  key: 'needs_offer' | 'pending_approval' | 'held'
) => rows.reduce((acc, r) => acc + (r[key]?.requests ?? 0), 0)

export function standsSummary(strip: readonly ApiAidRoundCounts[]): string {
  const rounds = [...strip].sort((a, b) => a.round - b.round)
  const posted = rounds
    .map((r) => `Round ${String(r.round)} ${String(r.posted?.requests ?? 0)}`)
    .join(', ')
  return [
    `needs an offer ${req(sum(rounds, 'needs_offer'))}`,
    `pending approval ${req(sum(rounds, 'pending_approval'))}`,
    `held ${req(sum(rounds, 'held'))}`,
    `posted ${posted} req`,
  ].join(' · ')
}

export function belowSummary(budget: ApiAidBudget, pool: string | null): string {
  const scope = scopePool(budget, pool)
  if (scope === undefined) return ''
  const grants =
    (scope.below.outside_grants ?? 0) +
    (pool === null ? (budget.outside_grants_off_requests ?? 0) : 0)
  // The mock names the outside fund generically here; its own name is on its row in the table.
  const funds = (scope.decision_types ?? []).filter((t) => !t.counts_toward_budget)
  const fundsMoney = formatMoney(funds.reduce((acc, t) => acc + (t.amount ?? 0), 0))
  const outside =
    funds.length === 0
      ? []
      : [
          funds.length === 1
            ? `a named outside fund ${fundsMoney}`
            : `${String(funds.length)} named outside funds ${fundsMoney}`,
        ]
  const held = scope.below.held?.requests ?? 0
  return [
    `outside grants ${formatMoney(grants)}`,
    ...outside,
    `${String(held)} held ${held === 1 ? 'request' : 'requests'}`,
  ].join(' · ')
}

export function demandSummary(scope: ApiAidBudgetPool): string {
  const d = scope.demand
  return (
    `Round 2 asks so far ${demandMoney(d.round2_asked)} (${req(d.round2_asks?.requests ?? 0)}) · ` +
    `Round 1 unmet ask ${demandMoney(d.round1_unmet)} (${req(d.round1_unmet_requests?.requests ?? 0)})`
  )
}

export function typesSummary(scope: ApiAidBudgetPool): string {
  return (scope.decision_types ?? [])
    .filter((t) => t.counts_toward_budget)
    .map((t) =>
      t.key === null ? `no named type ${formatMoney(t.amount)}` : `${t.label} ${formatMoney(t.own)}`
    )
    .join(' · ')
}
