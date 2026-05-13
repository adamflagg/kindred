import { buildRunSummary, type RunSummary } from './buildRunSummary'
import {
  COMPARABLE_METRICS,
  formatMetric,
  getMetric,
  type MetricInterpretation,
} from './metricRegistry'
import { pickStat } from './pickStat'
import { buildRunTitle } from './runTitle'

import type { SolverRun } from '../../../hooks/useSolverRuns'

export type DeltaDirection = 'improved' | 'regressed' | 'unchanged' | 'context' | 'missing'

export interface MetricDelta {
  label: string
  a: string | null
  b: string | null
  delta_raw: number | null
  delta_formatted: string | null
  direction: DeltaDirection
}

export interface ComparisonSummary {
  kind: 'solver_run_comparison'
  run_a: RunSummary & { title: string }
  run_b: RunSummary & { title: string }
  deltas: Record<string, MetricDelta>
}

function configSnapshotsMatch(runA: SolverRun, runB: SolverRun): boolean {
  const a = runA.details?.config_snapshot
  const b = runB.details?.config_snapshot
  if (!a || !b) return false
  const keysA = Object.keys(a)
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

function effectiveInterpretation(
  key: string,
  runA: SolverRun,
  runB: SolverRun
): MetricInterpretation {
  const meta = getMetric(key)
  if (key === 'objective_value' && configSnapshotsMatch(runA, runB)) return 'higher-better'
  return meta.interpretation
}

function formatRawDelta(key: string, delta: number): string {
  const fmt = getMetric(key).format
  const sign = delta >= 0 ? '+' : ''
  const arrow = delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : ''
  if (fmt === 'percent') return `${sign}${(delta * 100).toFixed(2)}%${arrow}`
  if (fmt === 'duration') return `${sign}${delta.toFixed(1)}s${arrow}`
  if (fmt === 'decimal')
    return `${sign}${delta.toLocaleString('en-US', { maximumFractionDigits: 2 })}${arrow}`
  return `${sign}${delta.toLocaleString('en-US', { maximumFractionDigits: 0 })}${arrow}`
}

function directionFor(delta: number, interpretation: MetricInterpretation): DeltaDirection {
  if (delta === 0) return 'unchanged'
  if (interpretation === 'context') return 'context'
  const positive =
    (interpretation === 'higher-better' && delta > 0) ||
    (interpretation === 'lower-better' && delta < 0)
  return positive ? 'improved' : 'regressed'
}

export function buildComparisonSummary(runA: SolverRun, runB: SolverRun): ComparisonSummary {
  const deltas: Record<string, MetricDelta> = {}

  for (const key of COMPARABLE_METRICS) {
    const aRaw = pickStat(runA.stats, key)
    const bRaw = pickStat(runB.stats, key)
    if ((aRaw === null || aRaw === undefined) && (bRaw === null || bRaw === undefined)) {
      // Neither side has it — skip entirely.
      continue
    }
    const meta = getMetric(key)
    const aFmt = aRaw === null || aRaw === undefined ? null : formatMetric(key, aRaw)
    const bFmt = bRaw === null || bRaw === undefined ? null : formatMetric(key, bRaw)
    let delta: number | null = null
    let deltaFmt: string | null = null
    let direction: DeltaDirection = 'missing'
    if (aRaw !== null && aRaw !== undefined && bRaw !== null && bRaw !== undefined) {
      delta = bRaw - aRaw
      deltaFmt = formatRawDelta(key, delta)
      direction = directionFor(delta, effectiveInterpretation(key, runA, runB))
    }
    deltas[key] = {
      label: meta.label,
      a: aFmt,
      b: bFmt,
      delta_raw: delta,
      delta_formatted: deltaFmt,
      direction,
    }
  }

  return {
    kind: 'solver_run_comparison',
    run_a: { title: buildRunTitle(runA), ...buildRunSummary(runA) },
    run_b: { title: buildRunTitle(runB), ...buildRunSummary(runB) },
    deltas,
  }
}
