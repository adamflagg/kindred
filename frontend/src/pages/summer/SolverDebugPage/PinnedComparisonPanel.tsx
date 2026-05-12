import React from 'react'

import {
  COMPARABLE_METRICS,
  formatMetric,
  getMetric,
  type MetricGroup,
  type MetricInterpretation,
} from './metricRegistry'
import { pickStat } from './pickStat'

import type { SolverRun } from '../../../hooks/useSolverRuns'

interface Props {
  runA: SolverRun | null
  runB: SolverRun | null
  onClear: () => void
}

function deltaClass(
  metricKey: string,
  delta: number | null,
  runA: SolverRun,
  runB: SolverRun
): string {
  if (delta === null) return 'text-gray-400'
  const meta = getMetric(metricKey)
  if (delta === 0) return 'text-gray-500'
  const interpretation = effectiveInterpretation(meta, runA, runB)
  if (interpretation === 'context') return 'text-gray-500 font-semibold'
  const better =
    (interpretation === 'lower-better' && delta < 0) ||
    (interpretation === 'higher-better' && delta > 0)
  return better ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'
}

function formatDelta(metricKey: string, delta: number | null): string {
  if (delta === null) return '—'
  const meta = getMetric(metricKey)
  const sign = delta >= 0 ? '+' : ''
  const arrow = delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : ''
  if (meta.format === 'percent') return `${sign}${(delta * 100).toFixed(2)}%${arrow}`
  if (meta.format === 'duration') return `${sign}${delta.toFixed(1)}s${arrow}`
  if (meta.format === 'decimal')
    return `${sign}${delta.toLocaleString('en-US', { maximumFractionDigits: 2 })}${arrow}`
  return `${sign}${delta.toLocaleString('en-US', { maximumFractionDigits: 0 })}${arrow}`
}

function shouldHighlight(
  meta: ReturnType<typeof getMetric>,
  runA: SolverRun,
  runB: SolverRun
): boolean {
  if (!meta.highlight) return false
  if (meta.highlight.mode === 'on-delta') {
    return pickStat(runA.stats, meta.key) !== pickStat(runB.stats, meta.key)
  }
  // diverges-from: remaining union branch
  const fromKey = meta.highlight.from
  return (
    pickStat(runA.stats, meta.key) !== pickStat(runA.stats, fromKey) ||
    pickStat(runB.stats, meta.key) !== pickStat(runB.stats, fromKey)
  )
}

function configSnapshotsMatch(runA: SolverRun, runB: SolverRun): boolean {
  const a = runA.details?.config_snapshot
  const b = runB.details?.config_snapshot
  if (!a || !b) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((k) => a[k] === b[k])
}

function effectiveInterpretation(
  meta: ReturnType<typeof getMetric>,
  runA: SolverRun,
  runB: SolverRun
): MetricInterpretation {
  if (meta.key === 'objective_value' && configSnapshotsMatch(runA, runB)) {
    return 'higher-better'
  }
  return meta.interpretation
}

const GROUP_LABELS: Record<MetricGroup, string> = {
  outcome: 'Outcome',
  size: 'Size',
  timing: 'Timing',
  quality: 'Quality',
  churn: 'Churn',
  search: 'Search',
  model: 'Model',
  context: 'Context',
}

const GROUP_ORDER: MetricGroup[] = [
  'outcome',
  'size',
  'timing',
  'quality',
  'churn',
  'search',
  'model',
]

export function PinnedComparisonPanel({ runA, runB, onClear }: Props) {
  if (!runA || !runB) return null

  const aCount = runA.details?.session_attendee_count
  const bCount = runB.details?.session_attendee_count
  const drift = aCount !== undefined && bCount !== undefined && aCount !== bCount

  // Group metrics by their `group` field, preserving COMPARABLE_METRICS order within each group
  const byGroup: Record<MetricGroup, string[]> = {
    outcome: [],
    size: [],
    timing: [],
    quality: [],
    churn: [],
    search: [],
    model: [],
    context: [],
  }
  for (const key of COMPARABLE_METRICS) {
    byGroup[getMetric(key).group].push(key)
  }

  return (
    <div className="shadow-lodge border-forest-200 rounded-xl border-2 bg-white">
      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
        <span className="text-forest-700 text-sm font-semibold">📌 Comparing 2 pinned runs</span>
        {drift ? (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            ⚠ attendee count differs ({aCount} vs {bCount}) — comparisons may not be
            apples-to-apples
          </span>
        ) : null}
        <button onClick={onClear} className="ml-auto text-xs text-gray-400 hover:text-gray-600">
          clear pins
        </button>
      </div>
      <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead className="bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
          <tr>
            <th className="px-5 py-2 text-left font-medium">Metric</th>
            <th className="px-3 py-2 text-right font-medium">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />
              Run A · {runA.details?.git_sha?.slice(0, 7) ?? '—'}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-700" />
              Run B · {runB.details?.git_sha?.slice(0, 7) ?? '—'}
            </th>
            <th className="px-5 py-2 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {GROUP_ORDER.map((group) => {
            const keys = byGroup[group]
            if (keys.length === 0) return null
            return (
              <React.Fragment key={group}>
                <tr className="bg-gray-50">
                  <td
                    colSpan={4}
                    className="px-5 py-1 text-xs font-semibold tracking-wide text-gray-600 uppercase"
                  >
                    {GROUP_LABELS[group]}
                  </td>
                </tr>
                {keys.map((key) => {
                  const meta = getMetric(key)
                  const va = pickStat(runA.stats, key)
                  const vb = pickStat(runB.stats, key)
                  const delta = va != null && vb != null ? vb - va : null
                  const isChild = meta.parent != null
                  const rowBg = shouldHighlight(meta, runA, runB) ? 'bg-yellow-50' : ''
                  return (
                    <tr key={key} className={`hover:bg-forest-50/30 ${rowBg}`}>
                      <td
                        className={`px-5 py-2 text-gray-700 ${isChild ? 'pl-10' : ''} ${meta.description ? 'cursor-help' : ''}`}
                        title={meta.description || undefined}
                      >
                        {meta.label}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {formatMetric(key, va)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {formatMetric(key, vb)}
                      </td>
                      <td className={`px-5 py-2 text-right ${deltaClass(key, delta, runA, runB)}`}>
                        {formatDelta(key, delta)}
                      </td>
                    </tr>
                  )
                })}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
