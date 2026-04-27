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
      const delta = debugAt - finishedAt
      if (delta >= 0 && delta <= GRACE_WINDOW_MS) return doneFromDebug(debug)
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

export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

type RawSyncEntry = {
  type?: string
  status?: string
  start_time?: string
  end_time?: string
  error?: string
}

type RawSyncStatusResponse = Record<string, RawSyncEntry | boolean | string | number>

function normalizeStatus(raw: string | undefined): SyncJobStatus['status'] | null {
  if (raw === 'running') return 'running'
  if (raw === 'completed' || raw === 'success') return 'completed'
  if (raw === 'failed') return 'failed'
  if (raw === 'pending') return 'queued'
  if (raw === 'idle' || raw === undefined) return null
  console.warn(`[csvPipelineStatus] unknown sync status: ${raw}`)
  return null
}

export async function fetchSyncStatus(fetchWithAuth: FetchWithAuth): Promise<SyncJobStatus | null> {
  const res = await fetchWithAuth('/api/custom/sync/status')
  if (!res.ok) throw new Error(`sync status: ${res.status}`)
  const data = (await res.json()) as RawSyncStatusResponse
  const entry = data['bunk_requests']
  if (!entry || typeof entry !== 'object' || !('status' in entry)) return null
  const sync = entry as RawSyncEntry
  const normalized = normalizeStatus(sync.status)
  if (normalized === null) return null
  if (!sync.start_time) {
    if (normalized !== 'queued') {
      console.warn(`[csvPipelineStatus] sync entry has status "${normalized}" but no start_time`)
    }
    return null
  }
  const result: SyncJobStatus = {
    name: 'bunk_requests',
    status: normalized,
    startedAt: sync.start_time,
  }
  if (sync.end_time) result.finishedAt = sync.end_time
  if (sync.error) result.error = sync.error
  return result
}

type RawDebugListResponse = {
  items: Array<{
    run_id: string
    created: string
    status_breakdown: { status_resolved: number; status_pending: number; status_declined: number }
  }>
}

export async function fetchLatestDebugRun(
  fetchWithAuth: FetchWithAuth
): Promise<DebugPipelineRun | null> {
  const res = await fetchWithAuth(
    '/api/collections/debug_pipeline_runs/records?sort=-created&perPage=1&fields=run_id,created,status_breakdown'
  )
  if (!res.ok) throw new Error(`debug runs: ${res.status}`)
  const data = (await res.json()) as RawDebugListResponse
  const first = data.items[0]
  if (!first) return null
  return {
    run_id: first.run_id,
    created: first.created,
    status_breakdown: first.status_breakdown,
  }
}
