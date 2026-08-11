import { Check, Copy, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import { copyText } from '../../../utils/copyText'

import { buildComparisonSummary, type DeltaDirection } from './buildComparisonSummary'
import { COMPARABLE_METRICS, formatMetric, getMetric, type MetricGroup } from './metricRegistry'
import { pickStat } from './pickStat'

import type { SolverRun } from '../../../hooks/useSolverRuns'

interface Props {
  runA: SolverRun | null
  runB: SolverRun | null
  onClear: () => void
}

const DIRECTION_CLASS: Record<DeltaDirection, string> = {
  improved: 'text-green-700 font-semibold',
  regressed: 'text-red-700 font-semibold',
  context: 'text-gray-500 font-semibold',
  unchanged: 'text-gray-500',
  missing: 'text-gray-400',
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

const GROUP_LABELS: Record<MetricGroup, string> = {
  outcome_requests: 'Outcome (requests)',
  outcome_campers: 'Outcome (campers)',
  size: 'Size',
  timing: 'Timing',
  quality: 'Quality',
  churn: 'Churn',
  search: 'Search',
  model: 'Model',
  context: 'Context',
}

const GROUP_ORDER: MetricGroup[] = [
  'outcome_requests',
  'outcome_campers',
  'quality',
  'churn',
  'timing',
  'size',
  'search',
  'model',
]

export function PinnedComparisonPanel({ runA, runB, onClear }: Props) {
  if (!runA || !runB) return null

  const aCount = runA.details?.session_attendee_count
  const bCount = runB.details?.session_attendee_count
  const drift = aCount !== undefined && bCount !== undefined && aCount !== bCount

  const summary = buildComparisonSummary(runA, runB)

  // Group metrics by their `group` field, preserving COMPARABLE_METRICS order within each group
  const byGroup: Record<MetricGroup, string[]> = {
    outcome_requests: [],
    outcome_campers: [],
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
      <div className="sticky top-0 z-10 flex items-center gap-3 rounded-t-xl border-b border-gray-100 bg-white/95 px-5 py-3 backdrop-blur">
        <span className="text-forest-700 text-sm font-semibold">📌 Comparing 2 pinned runs</span>
        {drift ? (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            ⚠ attendee count differs ({aCount} vs {bCount}) — comparisons may not be
            apples-to-apples
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <CopyComparisonJsonButton runA={runA} runB={runB} />
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear pins"
            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
          >
            <X className="h-3.5 w-3.5" />
            Clear pins
          </button>
        </div>
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
                  const delta = summary.deltas[key]
                  const va = pickStat(runA.stats, key)
                  const vb = pickStat(runB.stats, key)
                  const isChild = meta.parent != null
                  const rowBg = shouldHighlight(meta, runA, runB) ? 'bg-yellow-50' : ''
                  const directionClass = delta
                    ? DIRECTION_CLASS[delta.direction]
                    : DIRECTION_CLASS['missing']
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
                      <td className={`px-5 py-2 text-right ${directionClass}`}>
                        {delta?.delta_formatted ?? '—'}
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

function CopyComparisonJsonButton({ runA, runB }: { runA: SolverRun; runB: SolverRun }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const onClick = async () => {
    const payload = JSON.stringify(buildComparisonSummary(runA, runB), null, 2)
    const ok = await copyText(payload)
    if (!ok) return
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? 'Copied!' : 'Copy JSON'}
      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-600" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </>
      )}
    </button>
  )
}
