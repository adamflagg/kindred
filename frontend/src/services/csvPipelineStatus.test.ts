import { describe, it, expect, vi } from 'vitest'
import {
  derivePhase,
  fetchSyncStatus,
  fetchLatestDebugRun,
  countsFromStatusBreakdown,
  fetchLatestUploadRun,
  type SyncJobStatus,
  type DebugPipelineRun,
} from './csvPipelineStatus'

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

describe('derivePhase', () => {
  it('returns idle when nothing has ever run', () => {
    expect(derivePhase(null, null, null)).toEqual({ phase: 'idle' })
  })

  describe('CSV upload gating', () => {
    it('returns idle for a running sync when no CSV upload context exists (nightly cron)', () => {
      const sync: SyncJobStatus = { name: 'bunk_requests', status: 'running', startedAt: ago(1) }
      expect(derivePhase(sync, null, null).phase).toBe('idle')
    })

    it('returns idle for a completed sync with no debug row when no CSV upload context (nightly cron)', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(2),
      }
      expect(derivePhase(sync, null, null).phase).toBe('idle')
    })

    it('returns idle when CSV upload is too far from sync.startedAt (> 10 min apart)', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(2),
        finishedAt: ago(1),
      }
      const csvUploadStartedAt = ago(30) // upload was 28 min before sync started
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('idle')
    })

    it('returns idle when sync started well BEFORE the upload (cron mid-flight, then user uploads)', () => {
      // A cron sync started 8 minutes ago. User uploads 1 minute ago. With a
      // symmetric Math.abs check, the cron's running state would be incorrectly
      // attributed to the upload — exactly the bug in the inverted-time
      // direction. Direction matters: only syncs at-or-after the upload count.
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'running',
        startedAt: ago(8),
      }
      const csvUploadStartedAt = ago(1)
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('idle')
    })

    it('returns idle when a cron sync completed shortly before the upload', () => {
      // Cron at 02:00, user uploads at 02:05. The cron's `done` state must NOT
      // be displayed as the user's upload result.
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(8),
        finishedAt: ago(6),
      }
      const fresh: DebugPipelineRun = {
        run_id: 'r-cron-recent',
        created: ago(5),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(2)
      expect(derivePhase(sync, fresh, csvUploadStartedAt).phase).toBe('idle')
    })
  })

  describe('clock skew tolerance', () => {
    it('attributes a sync that started slightly before the upload (small client/server clock skew)', () => {
      // Client clock is ~30 seconds ahead of server. The upload marker says
      // T+30s but the server-recorded sync.startedAt says T+0. Within bounded
      // skew tolerance, attribute the sync.
      const now = Date.now()
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'running',
        startedAt: new Date(now).toISOString(),
      }
      const csvUploadStartedAt = new Date(now + 30_000).toISOString()
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('importing')
    })

    it('rejects a sync that started well before the upload, beyond skew tolerance', () => {
      // Sync started 5 min before the upload — beyond reasonable clock skew,
      // indicating a pre-existing cron run rather than this user's upload.
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'running',
        startedAt: ago(7),
      }
      const csvUploadStartedAt = ago(2)
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('idle')
    })

    it('returns idle for a completed cron sync with a fresh debug row but no CSV upload context', () => {
      // Cron also runs process_requests in IS_DOCKER, which writes a debug row.
      // Without a CSV upload from this browser, the user shouldn't see "Done at 3am" notifications.
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(3),
      }
      const fresh: DebugPipelineRun = {
        run_id: 'r-cron',
        created: ago(1),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      expect(derivePhase(sync, fresh, null).phase).toBe('idle')
    })

    it('returns idle for a failed sync with no CSV upload context (cron failure invisible to user)', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(60),
        finishedAt: ago(40),
        error: 'context deadline exceeded',
      }
      expect(derivePhase(sync, null, null).phase).toBe('idle')
    })
  })

  describe('CSV upload flow phases', () => {
    it('returns importing when sync is running and CSV upload context exists', () => {
      const startedAt = ago(1)
      const sync: SyncJobStatus = { name: 'bunk_requests', status: 'running', startedAt }
      const csvUploadStartedAt = ago(2) // upload kicked off the sync 1 min before it started
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('importing')
    })

    it('returns matching when sync completed but no debug row yet, with CSV context', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(2),
      }
      const csvUploadStartedAt = ago(6)
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('matching')
    })

    it('returns matching when debug row exists but is older than current sync, with CSV context', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(2),
      }
      const stale: DebugPipelineRun = {
        run_id: 'old',
        created: ago(60),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(6)
      expect(derivePhase(sync, stale, csvUploadStartedAt).phase).toBe('matching')
    })

    it('returns done with counts when fresh debug row exists, with CSV context', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(3),
      }
      const fresh: DebugPipelineRun = {
        run_id: 'r1',
        created: ago(1),
        status_breakdown: { resolved: 20, pending: 6, declined: 2 },
      }
      const csvUploadStartedAt = ago(6)
      const result = derivePhase(sync, fresh, csvUploadStartedAt)
      expect(result.phase).toBe('done')
      expect(result).toMatchObject({
        counts: { total: 28, autoMatched: 22, needReview: 6 },
        runId: 'r1',
      })
    })

    it('returns error on failed sync when CSV context exists', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(8),
        finishedAt: ago(2),
        error: 'context deadline exceeded',
      }
      const csvUploadStartedAt = ago(9)
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('error')
    })

    it('keeps error when debug row predates finishedAt (negative grace delta is rejected)', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(60),
        finishedAt: ago(40),
        error: 'context deadline exceeded',
      }
      const stale: DebugPipelineRun = {
        run_id: 'r-stale',
        created: ago(50),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(61)
      expect(derivePhase(sync, stale, csvUploadStartedAt).phase).toBe('error')
    })

    it('keeps error when debug row is outside the 30-min grace window', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(120),
        finishedAt: ago(100),
        error: 'context deadline exceeded',
      }
      const tooLate: DebugPipelineRun = {
        run_id: 'r3',
        created: ago(50),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(121)
      expect(derivePhase(sync, tooLate, csvUploadStartedAt).phase).toBe('error')
    })

    it('treats exactly 30-min delta as done (inclusive boundary)', () => {
      // Anchor both timestamps to a single `now`: two separate ago() calls each
      // read Date.now(), so the delta is 30min + sub-ms jitter and tips the
      // inclusive boundary to 'error' on a slow runner (flaky in CI).
      const now = Date.now()
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(90),
        finishedAt: new Date(now - 60 * 60_000).toISOString(),
        error: 'context deadline exceeded',
      }
      const debug: DebugPipelineRun = {
        run_id: 'r-boundary',
        created: new Date(now - 30 * 60_000).toISOString(),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(91)
      expect(derivePhase(sync, debug, csvUploadStartedAt).phase).toBe('done')
    })

    it('treats just past 30-min delta as error (exclusive past boundary)', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(90),
        finishedAt: ago(60),
        error: 'context deadline exceeded',
      }
      const debug: DebugPipelineRun = {
        run_id: 'r-just-past',
        created: new Date(Date.now() - 29.99 * 60_000).toISOString(),
        status_breakdown: { resolved: 1, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(91)
      expect(derivePhase(sync, debug, csvUploadStartedAt).phase).toBe('error')
    })

    it('recovers as done when orphan python finishes within 30-min grace window', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'failed',
        startedAt: ago(60),
        finishedAt: ago(40),
        error: 'context deadline exceeded',
      }
      const orphan: DebugPipelineRun = {
        run_id: 'r2',
        created: ago(20),
        status_breakdown: { resolved: 5, pending: 1, declined: 0 },
      }
      // Long-running uploads can outlast the upload marker — proximity is checked, but
      // orphan grace recovery is itself evidence the upload's matching ran. Pass a
      // CSV upload context near startedAt to satisfy gating.
      const csvUploadStartedAt = ago(61)
      expect(derivePhase(sync, orphan, csvUploadStartedAt).phase).toBe('done')
    })

    it('handles all-zeros (csv-history dedup re-upload) as done', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(2),
        finishedAt: ago(1),
      }
      const dedup: DebugPipelineRun = {
        run_id: 'r4',
        created: ago(0.5),
        status_breakdown: { resolved: 0, pending: 0, declined: 0 },
      }
      const csvUploadStartedAt = ago(3)
      const result = derivePhase(sync, dedup, csvUploadStartedAt)
      expect(result.phase).toBe('done')
      expect(result).toMatchObject({ counts: { total: 0, autoMatched: 0, needReview: 0 } })
    })
  })

  describe('stuck-matching safety net', () => {
    it('transitions matching to error when sync finished long ago and no debug row arrived', () => {
      // Sync finished 15 min ago with CSV context, but matching never wrote a debug row.
      // Without this safety net, the indicator would spin forever.
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(20),
        finishedAt: ago(15),
      }
      const csvUploadStartedAt = ago(21)
      const result = derivePhase(sync, null, csvUploadStartedAt)
      expect(result.phase).toBe('error')
    })

    it('keeps matching when sync finished within MATCHING_MAX_AGE_MS', () => {
      const sync: SyncJobStatus = {
        name: 'bunk_requests',
        status: 'completed',
        startedAt: ago(5),
        finishedAt: ago(2),
      }
      const csvUploadStartedAt = ago(6)
      expect(derivePhase(sync, null, csvUploadStartedAt).phase).toBe('matching')
    })
  })
})

describe('fetchSyncStatus', () => {
  it('returns the bunk_requests entry mapped to camelCase', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bunk_requests: {
          type: 'bunk_requests',
          status: 'completed',
          start_time: '2026-04-27T19:00:00Z',
          end_time: '2026-04-27T19:02:00Z',
        },
        process_requests: { status: 'idle' },
        _daily_sync_running: false,
      }),
    })
    const res = await fetchSyncStatus(mock)
    expect(res).toEqual({
      name: 'bunk_requests',
      status: 'completed',
      startedAt: '2026-04-27T19:00:00Z',
      finishedAt: '2026-04-27T19:02:00Z',
    })
  })

  it('treats "success" status as equivalent to "completed"', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bunk_requests: {
          type: 'bunk_requests',
          status: 'success',
          start_time: '2026-04-27T19:00:00Z',
          end_time: '2026-04-27T19:02:00Z',
        },
      }),
    })
    const res = await fetchSyncStatus(mock)
    expect(res?.status).toBe('completed')
  })

  it('preserves error message on failed status', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bunk_requests: {
          type: 'bunk_requests',
          status: 'failed',
          start_time: '2026-04-27T19:00:00Z',
          end_time: '2026-04-27T19:02:00Z',
          error: 'context deadline exceeded',
        },
      }),
    })
    const res = await fetchSyncStatus(mock)
    expect(res?.status).toBe('failed')
    expect(res?.error).toBe('context deadline exceeded')
  })

  it('returns null when bunk_requests entry is idle', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bunk_requests: { status: 'idle' } }),
    })
    expect(await fetchSyncStatus(mock)).toBeNull()
  })

  it('returns null when bunk_requests entry is missing entirely', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _daily_sync_running: false }),
    })
    expect(await fetchSyncStatus(mock)).toBeNull()
  })

  it('throws on non-ok response', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchSyncStatus(mock)).rejects.toThrow()
  })

  it('warns when bunk_requests status is unrecognized but still returns null gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bunk_requests: {
          type: 'bunk_requests',
          status: 'cancelled',
          start_time: '2026-04-27T19:00:00Z',
        },
      }),
    })
    expect(await fetchSyncStatus(mock)).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown sync status: cancelled'))
    warnSpy.mockRestore()
  })

  it('returns null silently when status is queued and start_time is absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bunk_requests: { type: 'bunk_requests', status: 'pending' },
      }),
    })
    expect(await fetchSyncStatus(mock)).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('fetchLatestDebugRun', () => {
  it('extracts run_id, created, status_breakdown from items[0]', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'pb-id',
            run_id: 'run-abc',
            created: '2026-04-27T19:05:00Z',
            status_breakdown: { resolved: 5, pending: 1, declined: 0 },
            year: 2026,
            trace_count: 6,
          },
        ],
        totalItems: 1,
      }),
    })
    const res = await fetchLatestDebugRun(mock)
    expect(res).toEqual({
      run_id: 'run-abc',
      created: '2026-04-27T19:05:00Z',
      status_breakdown: { resolved: 5, pending: 1, declined: 0 },
    })
  })

  it('returns null when items array is empty', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    })
    expect(await fetchLatestDebugRun(mock)).toBeNull()
  })

  it('throws on non-ok response', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchLatestDebugRun(mock)).rejects.toThrow()
  })

  it('returns null when status_breakdown is missing from the row', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'run-malformed',
            created: '2026-04-27T19:05:00Z',
            // status_breakdown intentionally absent (schema mismatch / partial write)
          },
        ],
      }),
    })
    expect(await fetchLatestDebugRun(mock)).toBeNull()
  })

  it('returns null when status_breakdown.resolved is non-numeric', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'run-bad-type',
            created: '2026-04-27T19:05:00Z',
            status_breakdown: { resolved: 'five', pending: 0, declined: 0 },
          },
        ],
      }),
    })
    expect(await fetchLatestDebugRun(mock)).toBeNull()
  })

  // Regression: trace_collector.py writes status_breakdown with unprefixed keys
  // (resolved/pending/declined/skipped/deduped). The frontend previously expected
  // a status_-prefixed shape and rejected every real row, causing the indicator
  // to surface "Matching step did not complete" 10 minutes after sync completion
  // even though processing had succeeded.
  it('parses the production status_breakdown shape (unprefixed keys from trace_collector.py)', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'pb-id',
            run_id: 'run-prod',
            created: '2026-04-27T19:05:00Z',
            status_breakdown: { resolved: 200, pending: 12, declined: 8, skipped: 3, deduped: 1 },
          },
        ],
        totalItems: 1,
      }),
    })
    const res = await fetchLatestDebugRun(mock)
    expect(res).not.toBeNull()
    expect(res?.run_id).toBe('run-prod')
    expect(res?.status_breakdown.resolved).toBe(200)
    expect(res?.status_breakdown.pending).toBe(12)
    expect(res?.status_breakdown.declined).toBe(8)
  })
})

describe('countsFromStatusBreakdown', () => {
  it('maps resolved+declined→autoMatched, pending→needReview', () => {
    expect(countsFromStatusBreakdown({ resolved: 10, pending: 3, declined: 1 })).toEqual({
      total: 14,
      autoMatched: 11,
      needReview: 3,
    })
  })
})

describe('fetchLatestUploadRun', () => {
  it("filters trigger='upload' and requests session_breakdown", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'r1',
            created: 't',
            status_breakdown: { resolved: 1, pending: 0, declined: 0 },
            session_breakdown: {},
          },
        ],
      }),
    })
    const run = await fetchLatestUploadRun(fetchWithAuth)
    const url = fetchWithAuth.mock.calls[0]![0] as string
    expect(url).toContain("trigger='upload'")
    expect(url).toContain('session_breakdown')
    expect(run?.run_id).toBe('r1')
  })
  it('returns null on non-ok response', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: false })
    expect(await fetchLatestUploadRun(fetchWithAuth)).toBeNull()
  })
  it('returns null when status_breakdown is malformed (non-numeric counts)', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'run-bad',
            created: 't',
            status_breakdown: { resolved: 'five', pending: 0, declined: 0 },
            session_breakdown: {},
          },
        ],
      }),
    })
    expect(await fetchLatestUploadRun(fetchWithAuth)).toBeNull()
  })

  it('drops malformed session_breakdown slices so counts never go NaN downstream', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'r1',
            created: 't',
            status_breakdown: { resolved: 9, pending: 2, declined: 0 },
            session_breakdown: {
              '1000001': { resolved: 8, pending: 2, declined: 0 }, // valid
              '1000002': { resolved: 'x', pending: 1, declined: 0 }, // malformed slice
            },
          },
        ],
      }),
    })
    const run = await fetchLatestUploadRun(fetchWithAuth)
    expect(run?.session_breakdown).toEqual({
      '1000001': { resolved: 8, pending: 2, declined: 0 },
    })
  })

  it('preserves a well-formed session_breakdown unchanged', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            run_id: 'r1',
            created: 't',
            status_breakdown: { resolved: 5, pending: 1, declined: 0 },
            session_breakdown: { '1000001': { resolved: 5, pending: 1, declined: 0 } },
          },
        ],
      }),
    })
    const run = await fetchLatestUploadRun(fetchWithAuth)
    expect(run?.session_breakdown).toEqual({
      '1000001': { resolved: 5, pending: 1, declined: 0 },
    })
  })
})

describe('derivePhase with production status_breakdown shape', () => {
  it("returns 'done' when fresh debug row arrives with unprefixed keys (regression for #1043)", () => {
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'completed',
      startedAt: ago(5),
      finishedAt: ago(3),
    }
    const fresh: DebugPipelineRun = {
      run_id: 'r-prod',
      created: ago(1),
      status_breakdown: { resolved: 200, pending: 12, declined: 8 },
    }
    const csvUploadStartedAt = ago(6)
    const result = derivePhase(sync, fresh, csvUploadStartedAt)
    expect(result.phase).toBe('done')
    expect(result).toMatchObject({
      counts: { total: 220, autoMatched: 208, needReview: 12 },
      runId: 'r-prod',
    })
  })
})
