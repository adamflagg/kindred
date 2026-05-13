import type { SolverRun } from '../../../hooks/useSolverRuns'

export function buildRunTitle(run: SolverRun): string {
  const sweep = run.details?.sweep_label?.trim()
  const source = run.details?.source_label?.trim() ?? 'Solver run'
  const created = run.created ? new Date(run.created) : null
  const time =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : ''
  const parts = [sweep, source, time].filter((p): p is string => Boolean(p))
  return parts.join(' · ')
}
