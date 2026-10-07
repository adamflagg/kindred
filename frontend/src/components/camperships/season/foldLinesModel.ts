/** Rounds & budget's fold lines and their URL state (spec §5.2 F, G). Pure; the server did every sum. */
import type { ApiAidBudget, ApiAidBudgetPool, ApiAidRoundCounts } from '../../../types/api-types'
import { formatMoney } from '../kit/money'
import { scopePool } from './budgetModel'

export type FoldLineKey = 'how' | 'stands' | 'below' | 'demand' | 'types' | 'notes'
export const lineKey = (key: FoldLineKey) => `lines:${key}`

/** `?open=budget,pool_a,lines:how` (D15, replaced). Today's `?fold=` is ignored and dropped on the next write. */
export function parseOpenKeys(raw: string | null): ReadonlySet<string> {
  return new Set((raw ?? '').split(',').filter((key) => key !== ''))
}

export function toggleOpenKey(open: ReadonlySet<string>, key: string): string | null {
  const next = new Set(open)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next.size === 0 ? null : [...next].join(',')
}

export const howLabel = (version: number | null) =>
  version === null ? 'How the rules count' : `How rules v${String(version)} count`
export const HOW_SUMMARY =
  'counts when offered · each pool keeps its own Remaining · only the total is a cap'
export const HOW_BODY =
  'Counts when offered: a round counts against Remaining once it is decided (Needs an offer), posted, or keyed for ' +
  'approval; Accepted is shown, never subtracted. Each pool keeps its own Remaining: money left in one pool never ' +
  'moves to another on its own; finance moves it by changing the program split (Edit Plan…). Only the total is a ' +
  "cap: a program's share is finance's guess at its need, so a pool past it reads amber, and only the season's total " +
  'below $0 reads red. Round 3 is whatever is left in the pool.'
export const HOW_NO_RULES = 'No approved rules: no total, no program split, nothing allocated.'

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
  const outside = (scope.decision_types ?? [])
    .filter((t) => !t.counts_toward_budget)
    .map((t) => `${t.label} ${formatMoney(t.amount)}`)
  return [
    `outside grants ${formatMoney(grants)}`,
    ...outside,
    `${String(scope.below.held?.requests ?? 0)} held req`,
  ].join(' · ')
}

export function demandSummary(scope: ApiAidBudgetPool): string {
  const d = scope.demand
  return (
    `Round 2 asks so far ${formatMoney(d.round2_asked)} (${req(d.round2_asks?.requests ?? 0)}) · ` +
    `Round 1 unmet ask ${formatMoney(d.round1_unmet)} (${req(d.round1_unmet_requests?.requests ?? 0)})`
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

export const notesLabel = (count: number) => `Notes 1–${String(count)}`
