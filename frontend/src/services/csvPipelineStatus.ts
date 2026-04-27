export type SyncJobStatus = {
  name: string
  status: 'running' | 'completed' | 'failed' | 'queued'
  startedAt: string
  finishedAt?: string
  error?: string
}

export type DebugPipelineRun = {
  run_id: string
  created: string
  status_breakdown: {
    status_resolved: number
    status_pending: number
    status_declined: number
    [k: string]: number
  }
}

export type PipelinePhase =
  | { phase: 'idle' }
  | { phase: 'importing'; startedAt: string }
  | { phase: 'matching'; startedAt: string }
  | {
      phase: 'done'
      runId: string
      finishedAt: string
      counts: { total: number; autoMatched: number; needReview: number }
    }
  | { phase: 'error'; finishedAt: string; message: string }

const GRACE_WINDOW_MS = 30 * 60_000

export function derivePhase(
  sync: SyncJobStatus | null,
  debug: DebugPipelineRun | null
): PipelinePhase {
  if (!sync) return { phase: 'idle' }

  const debugIsFresh =
    debug !== null && new Date(debug.created).getTime() >= new Date(sync.startedAt).getTime()

  if (sync.status === 'running') return { phase: 'importing', startedAt: sync.startedAt }

  if (sync.status === 'completed') {
    if (debugIsFresh && debug) return doneFromDebug(debug)
    return { phase: 'matching', startedAt: sync.startedAt }
  }

  if (sync.status === 'failed') {
    if (debugIsFresh && debug && sync.finishedAt) {
      const finishedAt = new Date(sync.finishedAt).getTime()
      const debugAt = new Date(debug.created).getTime()
      if (debugAt - finishedAt <= GRACE_WINDOW_MS) return doneFromDebug(debug)
    }
    return {
      phase: 'error',
      finishedAt: sync.finishedAt ?? sync.startedAt,
      message: sync.error ?? 'Unknown error',
    }
  }

  return { phase: 'idle' }
}

function doneFromDebug(d: DebugPipelineRun): PipelinePhase {
  const { status_resolved, status_pending, status_declined } = d.status_breakdown
  const autoMatched = status_resolved + status_declined
  const needReview = status_pending
  return {
    phase: 'done',
    runId: d.run_id,
    finishedAt: d.created,
    counts: { total: autoMatched + needReview, autoMatched, needReview },
  }
}
