import type { SessionBreakdown } from '../types/metrics'
import { transformSessionData, type ChartDataPoint } from './metricsTransforms'
import { pairSessions } from './sessionPairing'
import { rollUpTliSessions } from './tliRollup'
import type { SessionDateLookup, SessionTypeLookup } from './sessionUtils'

/**
 * Rows for the Overview's Session Enrollment Comparison, paired by `pairSessions` (epic #3207,
 * D-SESSION-MATCH) instead of by display name. Both years' TLI rows roll into one line first.
 * Each current row and the prior row(s) it pairs with share a `pairKey`; render the table with
 * `matchKey="pairKey"`. Several prior teen rows sum into one compare item; a prior session with
 * no pair keeps its own key and shows as GONE. Order is the chart order of each year.
 */
export function buildSessionComparisonData(
  currentRows: readonly SessionBreakdown[] | undefined,
  priorRows: readonly SessionBreakdown[] | undefined,
  sessionDateLookup: SessionDateLookup,
  sessionTypeLookup?: SessionTypeLookup
): { primaryData: ChartDataPoint[]; compareData: ChartDataPoint[] } {
  const current = rollUpTliSessions(currentRows ?? [])
  const prior = rollUpTliSessions(priorRows ?? [])
  const { pairs, retired } = pairSessions(current, prior)

  const pairKeyOfCurrent = new Map<SessionBreakdown, string>()
  const pairOfPrior = new Map<SessionBreakdown, { key: string; currentIndex: number }>()
  current.forEach((c, i) => {
    pairKeyOfCurrent.set(c, `pair-${i}`)
    for (const p of pairs[i] ?? []) pairOfPrior.set(p, { key: `pair-${i}`, currentIndex: i })
  })
  retired.forEach((p, i) => pairOfPrior.set(p, { key: `retired-${i}`, currentIndex: -1 }))

  const primaryData = transformSessionData(current, sessionDateLookup, sessionTypeLookup).map(
    (point) => {
      const row = current.find((c) => String(c.session_cm_id) === point['id'])
      return { ...point, pairKey: (row && pairKeyOfCurrent.get(row)) ?? `current-${point['id']}` }
    }
  )

  // One compare item per pair, at the place of its first prior row in the prior year's order.
  const priorPoints = transformSessionData(prior, sessionDateLookup, sessionTypeLookup)
  const compareByKey = new Map<string, ChartDataPoint>()
  for (const point of priorPoints) {
    const row = prior.find((p) => String(p.session_cm_id) === point['id'])
    const pair = row && pairOfPrior.get(row)
    if (!pair) continue
    const existing = compareByKey.get(pair.key)
    if (existing) {
      // A teen type taken from several prior routes: sum them, named as the current row.
      compareByKey.set(pair.key, {
        ...existing,
        name: primaryData[pair.currentIndex]?.name ?? existing.name,
        value: existing.value + point.value,
      })
    } else {
      compareByKey.set(pair.key, { ...point, pairKey: pair.key })
    }
  }
  return { primaryData, compareData: [...compareByKey.values()] }
}
