import { Check, Copy, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { REPO_URL } from '../../../constants/repo'
import { copyText } from '../../../utils/copyText'

import { buildRunSummary } from './buildRunSummary'
import { formatMetric, METRIC_REGISTRY_BY_GROUP, type MetricGroup } from './metricRegistry'
import { pickStat } from './pickStat'
import { buildRunTitle } from './runTitle'

import type { SolverRun } from '../../../hooks/useSolverRuns'

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
  'size',
  'timing',
  'quality',
  'churn',
  'search',
  'model',
]

interface Props {
  run: SolverRun | null
  onClose: () => void
}

export function DrillDownDrawer({ run, onClose }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  // Escape listener — re-binds whenever the onClose callback changes so it
  // always closes the *current* drawer. Cheap; no focus side effects.
  useEffect(() => {
    if (!run) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, onClose])

  // Focus management — fires only when the drawer opens/closes for a new run,
  // not when the parent re-renders (e.g. every 5 s during polling). Splitting
  // this out of the Escape effect prevents stealing focus from elements the
  // user has tabbed to inside the drawer.
  useEffect(() => {
    if (!run) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [run])

  if (!run) return null
  const s = run.stats ?? {}
  const d = run.details ?? {}

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-black/30" aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed top-16 right-0 bottom-0 z-40 w-[600px] overflow-y-auto border-l border-gray-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-forest-700 truncate font-sans text-sm font-semibold">
              {buildRunTitle(run)}
            </h3>
            <div className="font-mono text-[11px] text-gray-400">{run.run_id}</div>
          </div>
          <div className="flex items-center gap-2">
            <CopyJsonButton run={run} />
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Source:</span>{' '}
              <span className="font-medium">{d.source_label ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>{' '}
              <span className="font-medium">{s.status}</span>
            </div>
            {d.git_sha ? (
              <div className="col-span-2">
                <span className="text-gray-500">Git SHA:</span>{' '}
                <code className="text-xs">{d.git_sha}</code>{' '}
                <a
                  className="text-xs text-blue-600 hover:underline"
                  href={`${REPO_URL}/commit/${d.git_sha}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  view commit ↗
                </a>
              </div>
            ) : null}
            {d.sweep_label ? (
              <div className="col-span-2">
                <span className="text-gray-500">Sweep label:</span>{' '}
                <span className="font-medium">{d.sweep_label}</span>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {GROUP_ORDER.map((group) => {
              const metas = METRIC_REGISTRY_BY_GROUP[group]
              if (metas.length === 0) return null
              return (
                <StatCard
                  key={group}
                  title={GROUP_LABELS[group]}
                  rows={metas.map((meta) => [
                    meta.label,
                    formatMetric(meta.key, pickStat(s, meta.key)),
                  ])}
                />
              )
            })}
          </div>

          {s.solution_info ? (
            <div className="mt-4">
              <div className="mb-2 text-xs tracking-wide text-gray-500 uppercase">
                Solution strategy
              </div>
              <div
                className="rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700"
                title={s.solution_info}
              >
                {s.solution_info}
              </div>
            </div>
          ) : null}

          {s.constraint_type_breakdown ? (
            <div>
              <div className="mb-2 text-xs tracking-wide text-gray-500 uppercase">
                Constraint type breakdown
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {Object.entries(s.constraint_type_breakdown).map(([type, count]) => (
                  <span key={type} className="rounded bg-blue-50 px-3 py-1 text-blue-900">
                    {type}: {count.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {d.config_snapshot ? (
            <details className="rounded-lg bg-gray-50">
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium tracking-wide text-gray-500 uppercase">
                Config snapshot at run time ({Object.keys(d.config_snapshot).length} keys)
              </summary>
              <pre className="overflow-x-auto px-4 pb-4 text-xs text-gray-700">
                {JSON.stringify(d.config_snapshot, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </aside>
    </>
  )
}

function CopyJsonButton({ run }: { run: SolverRun }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const onClick = async () => {
    const payload = JSON.stringify(buildRunSummary(run), null, 2)
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
      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
          Copied!
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Copy JSON
        </>
      )}
    </button>
  )
}

function StatCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <div className="mb-2 text-xs tracking-wide text-gray-500 uppercase">{title}</div>
      <div className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <span className="text-gray-600">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
