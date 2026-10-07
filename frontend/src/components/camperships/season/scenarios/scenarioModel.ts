/**
 * Season › Scenarios' words for Fit to Budget (spec §7.4; D119). Pure. The sandbox's own words live in
 * controlsModel, spendModel, sandboxModel and compareModel; what is left here is Fit's answer in words.
 */
import type { ApiAidScenarioFit } from '../../../../types/api-types'
import { formatWholeMoney } from '../../kit/money'

/** "−5 pts", "+2.5 pts", "0 pts". */
export function shiftWords(points: number): string {
  if (points === 0) return '0 pts'
  return `${points < 0 ? '−' : '+'}${String(Math.abs(points))} pts`
}

// ── Fit to budget (fit.py; D119) ──────────────────────────────────────────────

/**
 * What Fit to budget found, in fit.py's terms: the largest shift on a half-point grid whose TOTAL row's
 * Round 1 Remaining (money on a program with no pool included) is still $0 or more (Round 2 and 3 money
 * already committed stays in it; no reserves are held back, parent §8.2), or that even the ends of its range (−100 to +100
 * pts) don't fit. The
 * tightest pool is information only (D119).
 */
export function fitWords(fit: ApiAidScenarioFit): {
  readonly headline: string
  readonly pool: string | null
} {
  const pool = fit.results.pools.find(
    (p) => p.pool === fit.tightest_pool && p.round1_remaining !== null
  )
  const tightest =
    pool === undefined
      ? null
      : `Tightest pool: ${pool.label}, Round 1 remaining ${formatWholeMoney(pool.round1_remaining)}. Pools are guidance; only the total budget is hard.`
  if (fit.outcome === 'over_at_lowest') {
    return {
      headline: `Even the lowest shift (${shiftWords(fit.tier_shift)}) leaves Round 1 over the budget.`,
      pool: tightest,
    }
  }
  if (fit.outcome === 'under_at_highest') {
    return {
      headline: `Even the highest shift (${shiftWords(fit.tier_shift)}) leaves part of the budget unused.`,
      pool: tightest,
    }
  }
  return {
    headline: `Shifting every tier ${shiftWords(fit.tier_shift)} uses the budget: Round 1 ${formatWholeMoney(fit.results.round1)}, ${formatWholeMoney(fit.results.round1_remaining)} left.`,
    pool: tightest,
  }
}
