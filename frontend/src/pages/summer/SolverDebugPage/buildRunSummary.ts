import {
  METRIC_REGISTRY_BY_GROUP,
  formatMetric,
  getMetric,
  type MetricGroup,
} from './metricRegistry'
import { pickStat } from './pickStat'

import type { SolverRun } from '../../../hooks/useSolverRuns'
import type { RequestBucket } from '../../../types/satisfaction'

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

export interface RunSummary {
  run_id: string
  context: {
    source?: string
    status?: string
    git_sha?: string
    sweep_label?: string
  }
  outcome_requests?: Record<string, string | number>
  outcome_campers?: Record<string, string | number>
  size?: Record<string, string | number>
  timing?: Record<string, string | number>
  quality?: Record<string, string | number>
  churn?: Record<string, string | number>
  search?: Record<string, string | number>
  model?: Record<string, string | number>
  solution_strategy?: string
  constraint_type_breakdown?: Record<string, number>
  soft_constraints_by_module?: Record<string, number>
  request_density_histogram_by_bucket?: Record<RequestBucket, Record<string, number>>
  impossible_request_breakdown?: Record<RequestBucket, Record<string, number>>
  config_snapshot?: Record<string, string>
}

/**
 * Percent / duration metrics stay as their formatted display strings
 * ("86.20%", "600.1s") so a paste mirrors the UI. Integers and decimals
 * are emitted as raw numbers — they read cleanly in JSON without locale
 * commas and stay machine-friendly.
 */
function metricValue(key: string, raw: number | null | undefined): string | number | undefined {
  if (raw === null || raw === undefined) return undefined
  const fmt = getMetric(key).format
  if (fmt === 'percent' || fmt === 'duration') return formatMetric(key, raw)
  return raw
}

/** True if any bucket in a per-bucket dict has at least one entry. */
export function hasNonEmptyBuckets(d: Record<string, Record<string, number>>): boolean {
  return Object.values(d).some((inner) => Object.keys(inner).length > 0)
}

export function buildRunSummary(run: SolverRun): RunSummary {
  const stats = run.stats ?? {}
  const details = run.details ?? {}

  const context: RunSummary['context'] = {}
  if (details.source_label) context.source = details.source_label
  if (stats.status) context.status = stats.status
  if (details.git_sha) context.git_sha = details.git_sha
  if (details.sweep_label) context.sweep_label = details.sweep_label

  const summary: RunSummary = {
    run_id: run.run_id,
    context,
  }

  for (const group of GROUP_ORDER) {
    const metas = METRIC_REGISTRY_BY_GROUP[group]
    const entries: Record<string, string | number> = {}
    for (const meta of metas) {
      const v = metricValue(meta.key, pickStat(stats, meta.key))
      if (v !== undefined) entries[meta.key] = v
    }
    if (Object.keys(entries).length > 0) {
      summary[group] = entries
    }
  }

  if (stats.solution_info) summary.solution_strategy = stats.solution_info
  if (stats.constraint_type_breakdown) {
    summary.constraint_type_breakdown = stats.constraint_type_breakdown
  }
  if (
    stats.soft_constraints_by_module &&
    Object.keys(stats.soft_constraints_by_module).length > 0
  ) {
    summary.soft_constraints_by_module = stats.soft_constraints_by_module
  }
  if (
    stats.request_density_histogram_by_bucket &&
    hasNonEmptyBuckets(stats.request_density_histogram_by_bucket)
  ) {
    summary.request_density_histogram_by_bucket = stats.request_density_histogram_by_bucket
  }
  const breakdown = stats.request_validation?.impossible_by_reason
  if (breakdown && hasNonEmptyBuckets(breakdown)) {
    summary.impossible_request_breakdown = breakdown
  }
  if (details.config_snapshot) summary.config_snapshot = details.config_snapshot

  return summary
}
