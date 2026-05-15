import type { SolverRunStats } from '../../../hooks/useSolverRuns'

export function pickStat(
  stats: SolverRunStats | undefined,
  key: string
): number | null | undefined {
  if (!stats) return undefined
  if (key === 'mp_request_rate') {
    const sat = stats.request_validation?.mp_requests_satisfied
    const tot = stats.request_validation?.mp_requests_total
    return tot ? (sat ?? 0) / tot : null
  }
  if (key === 'mp_camper_rate') {
    const sat = stats.request_validation?.mp_campers_satisfied
    const tot = stats.request_validation?.mp_campers_total
    return tot ? (sat ?? 0) / tot : null
  }
  if (key === 'all_request_rate') {
    const sat = stats.request_validation?.all_requests_satisfied
    const tot = stats.request_validation?.all_requests_total
    return tot ? (sat ?? 0) / tot : null
  }
  if (key === 'all_camper_rate') {
    const sat = stats.request_validation?.all_campers_satisfied
    const tot = stats.request_validation?.all_campers_total
    return tot ? (sat ?? 0) / tot : null
  }
  if (key === 'num_bool_or') return stats.constraint_type_breakdown?.['bool_or'] ?? null
  if (key === 'num_linear') return stats.constraint_type_breakdown?.['linear'] ?? null
  if (key === 'num_bool_and') return stats.constraint_type_breakdown?.['bool_and'] ?? null
  if (key === 'num_lin_max') return stats.constraint_type_breakdown?.['lin_max'] ?? null
  const rv = stats.request_validation as Record<string, number | null | undefined> | undefined
  if (rv && key in rv) return rv[key]
  return (stats as unknown as Record<string, number | null | undefined>)[key]
}
