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

// CSV upload marker must be within this window of the sync's startedAt for the
// indicator to attribute the sync to a CSV upload (vs a nightly cron run).
export const CSV_UPLOAD_PROXIMITY_MS = 10 * 60_000

// csvUploadStartedAt is a client-clock timestamp; sync.startedAt is a server-
// clock timestamp. Tolerate small skew (typical NTP drift) when comparing them
// while still rejecting pre-existing cron syncs that started well before the
// upload.
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000

// Safety net: if a sync completed but no debug pipeline row arrives within this
// window, the matching step is presumed crashed/short-circuited rather than
// still running. Surface as error instead of spinning forever.
const MATCHING_MAX_AGE_MS = 10 * 60_000

export const CSV_UPLOAD_STORAGE_KEY = 'csvUploadStartedAt'

function isSyncFromCsvUpload(syncStartedAt: string, csvUploadStartedAt: string | null): boolean {
  if (!csvUploadStartedAt) return false
  const csvAt = new Date(csvUploadStartedAt).getTime()
  const syncAt = new Date(syncStartedAt).getTime()
  if (Number.isNaN(csvAt) || Number.isNaN(syncAt)) return false
  // Sync must have started at or after the upload (allowing for bounded clock
  // skew). A pre-existing cron sync that started >tolerance before the upload
  // is rejected even if it falls within the proximity window.
  const delta = syncAt - csvAt
  return delta >= -CLOCK_SKEW_TOLERANCE_MS && delta <= CSV_UPLOAD_PROXIMITY_MS
}

export function derivePhase(
  sync: SyncJobStatus | null,
  debug: DebugPipelineRun | null,
  csvUploadStartedAt: string | null
): PipelinePhase {
  if (!sync) return { phase: 'idle' }

  // Gate every non-idle phase on evidence the sync was triggered by a CSV upload
  // from this browser. Nightly cron also runs `bunk_requests`, but the indicator
  // is a CSV-pipeline UI — surfacing cron progress/results here is wrong.
  if (!isSyncFromCsvUpload(sync.startedAt, csvUploadStartedAt)) {
    return { phase: 'idle' }
  }

  const debugIsFresh =
    debug !== null && new Date(debug.created).getTime() >= new Date(sync.startedAt).getTime()

  if (sync.status === 'running') return { phase: 'importing', startedAt: sync.startedAt }

  if (sync.status === 'completed') {
    if (debugIsFresh && debug) return doneFromDebug(debug)

    // No debug row yet. If matching has been pending too long, the trace
    // collector likely never wrote a row (empty traces, crash, or processor
    // never ran). Fall through to error rather than spin forever.
    const finishedMs = sync.finishedAt
      ? new Date(sync.finishedAt).getTime()
      : new Date(sync.startedAt).getTime()
    if (Date.now() - finishedMs > MATCHING_MAX_AGE_MS) {
      return {
        phase: 'error',
        finishedAt: sync.finishedAt ?? sync.startedAt,
        message: 'Matching step did not complete — check server logs',
      }
    }

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
