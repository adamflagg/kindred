import { COMPARABLE_METRICS, formatMetric, getMetric } from './metricRegistry'

import type { SolverRun, SolverRunStats } from '../../../hooks/useSolverRuns'

interface Props {
  runA: SolverRun | null
  runB: SolverRun | null
  onClear: () => void
}

function deltaClass(metricKey: string, delta: number | null): string {
  if (delta === null) return 'text-gray-400'
  const meta = getMetric(metricKey)
  if (delta === 0) return 'text-gray-500'
  if (meta.interpretation === 'context') return 'text-gray-500 font-semibold'
  const better =
    (meta.interpretation === 'lower-better' && delta < 0) ||
    (meta.interpretation === 'higher-better' && delta > 0)
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

function pickMetric(stats: SolverRunStats | undefined, key: string): number | null | undefined {
  if (!stats) return undefined
  if (key === 'num_bool_or') return stats.constraint_type_breakdown?.['bool_or'] ?? null
  return (stats as unknown as Record<string, number | null | undefined>)[key]
}

export function PinnedComparisonPanel({ runA, runB, onClear }: Props) {
  if (!runA || !runB) return null

  const aCount = runA.details?.session_attendee_count
  const bCount = runB.details?.session_attendee_count
  const drift = aCount !== undefined && bCount !== undefined && aCount !== bCount

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
          {COMPARABLE_METRICS.map((key) => {
            const meta = getMetric(key)
            const va = pickMetric(runA.stats, key)
            const vb = pickMetric(runB.stats, key)
            const delta = va != null && vb != null ? vb - va : null
            return (
              <tr key={key} className="hover:bg-forest-50/30">
                <td className="px-5 py-2">{meta.label}</td>
                <td className="px-3 py-2 text-right text-gray-600">{formatMetric(key, va)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{formatMetric(key, vb)}</td>
                <td className={`px-5 py-2 text-right ${deltaClass(key, delta)}`}>
                  {formatDelta(key, delta)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
