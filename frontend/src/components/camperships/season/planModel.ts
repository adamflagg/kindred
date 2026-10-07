/**
 * Edit Plan… (spec §5.2 B; budget-v9.html): the budget's total and program split, typed, checked and previewed. The
 * preview is the one exception to "the server did every sum" (D21): it shows a plan nobody has saved, from the read's
 * pool Committed and budget.py's formulas (Allocated = total × share, cents half up; Remaining = Allocated − Committed),
 * in whole cents and share units of 1/10,000 of a percent, so no float ever decides a figure. planModel.test.ts pins
 * that the approved plan reproduces the server's figures to the cent.
 */
import type { ApiAidBudget } from '../../../types/api-types'
import { formatMoney, toCents } from '../kit/money'

export interface TypedPlan {
  readonly total: string
  readonly shares: Readonly<Record<string, string>>
}

export interface PlanPool {
  readonly key: string
  readonly label: string
}

const MONEY = /^\d+(\.\d{1,2})?$/
const SHARE = /^\d+(\.\d{1,4})?$/
const UNITS = 10_000 // share units per percentage point
const HUNDRED_PCT = 100 * UNITS

/** "1000000.5" → 100000050 cents; null when not a non-negative amount with at most two decimals. */
function cents(text: string): number | null {
  const t = text.trim().replaceAll(',', '')
  if (!MONEY.test(t)) return null
  const [whole = '0', frac = ''] = t.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

/** "87.5" → 875000 units; null when not a non-negative share with at most four decimals. */
function units(text: string): number | null {
  const t = text.trim()
  if (!SHARE.test(t)) return null
  const [whole = '0', frac = ''] = t.split('.')
  return Number(whole) * UNITS + Number(frac.padEnd(4, '0'))
}

const unitsWords = (u: number) => String(Number((u / UNITS).toFixed(4)))

export function planOf(budget: {
  total: unknown
  pools: Record<string, { label: string; share_pct: unknown }>
}): { plan: TypedPlan; pools: PlanPool[] } {
  const pools = Object.entries(budget.pools).map(([key, pool]) => ({ key, label: pool.label }))
  return {
    plan: {
      total: String(budget.total),
      shares: Object.fromEntries(
        Object.entries(budget.pools).map(([key, pool]) => [key, String(pool.share_pct)])
      ),
    },
    pools,
  }
}

/** budget.py's `_cents(total × share / 100)`, half up, in integers: total in cents, share in units. */
export function allocationCents(totalCents: number, shareUnits: number): number {
  const product = totalCents * shareUnits // < 2^53 for any real budget: $10M × 100% is 1e15
  const q = Math.floor(product / HUNDRED_PCT)
  const r = product - q * HUNDRED_PCT
  return r * 2 >= HUNDRED_PCT ? q + 1 : q
}

const same = (a: TypedPlan, b: TypedPlan, keys: readonly string[]) =>
  cents(a.total) === cents(b.total) &&
  keys.every((k) => units(a.shares[k] ?? '') === units(b.shares[k] ?? ''))

/** The issue line's words, exact (the mock's). Save stays disabled while any shows. */
export function planIssues(typed: TypedPlan, opened: TypedPlan, keys: readonly string[]): string[] {
  const issues: string[] = []
  const total = cents(typed.total)
  if (total === null || total <= 0) issues.push('Type a total above $0')
  const shares = keys.map((k) => units(typed.shares[k] ?? ''))
  if (shares.some((u) => u === null)) issues.push('Every program needs a share')
  else {
    const sum = shares.reduce<number>((acc, u) => acc + (u ?? 0), 0)
    if (sum !== HUNDRED_PCT) issues.push(`Shares sum to ${unitsWords(sum)}%, not 100%`)
  }
  if (issues.length === 0 && same(typed, opened, keys)) issues.push('No change yet')
  return issues
}

/** "sums to 100% · Pool A $972,125 · …" once the shares sum to 100; else null. */
export function splitWords(typed: TypedPlan, pools: readonly PlanPool[]): string | null {
  const total = cents(typed.total)
  const shares = pools.map((p) => units(typed.shares[p.key] ?? ''))
  if (total === null || shares.some((u) => u === null)) return null
  if (shares.reduce<number>((acc, u) => acc + (u ?? 0), 0) !== HUNDRED_PCT) return null
  const each = pools.map(
    (p, i) => `${p.label} ${formatMoney(allocationCents(total, shares[i] ?? 0) / 100)}`
  )
  return ['sums to 100%', ...each].join(' · ')
}

export interface Preview {
  readonly pools: Readonly<Record<string, { allocated: number; remaining: number }>>
  readonly total: { allocated: number; remaining: number }
}

/** Every card re-drawn from the typed plan: Allocated and Remaining move, Committed never does. */
export function previewFigures(
  typed: TypedPlan,
  budget: ApiAidBudget,
  keys: readonly string[]
): Preview | null {
  const total = cents(typed.total)
  const shares = keys.map((k) => units(typed.shares[k] ?? ''))
  if (total === null || total <= 0 || shares.some((u) => u === null)) return null
  const pools: Record<string, { allocated: number; remaining: number }> = {}
  let allocatedSum = 0
  keys.forEach((key, i) => {
    const allocated = allocationCents(total, shares[i] ?? 0)
    allocatedSum += allocated
    const committed = toCents(budget.pools.find((p) => p.pool === key)?.total.committed ?? 0)
    pools[key] = { allocated: allocated / 100, remaining: (allocated - committed) / 100 }
  })
  const committed = toCents(budget.total.total.committed ?? 0)
  return {
    pools,
    total: { allocated: allocatedSum / 100, remaining: (allocatedSum - committed) / 100 },
  }
}

export function planContent(
  typed: TypedPlan,
  pools: readonly PlanPool[]
): { total: string; pools: Record<string, { label: string; share_pct: string }> } {
  return {
    total: typed.total.trim().replaceAll(',', ''),
    pools: Object.fromEntries(
      pools.map((p) => [p.key, { label: p.label, share_pct: (typed.shares[p.key] ?? '').trim() }])
    ),
  }
}

export function moved(
  server: number | null | undefined,
  shown: number | null | undefined
): boolean {
  if (server == null || shown == null) return false
  return toCents(server) !== toCents(shown)
}

export function draftPillWords(version: number, changes: number): string {
  return `rules draft v${String(version)}: ${String(changes)} budget ${changes === 1 ? 'change' : 'changes'}`
}
