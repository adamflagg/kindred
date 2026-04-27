import { describe, it, expect, vi } from 'vitest'
import {
  derivePhase,
  fetchSyncStatus,
  fetchLatestDebugRun,
  type SyncJobStatus,
  type DebugPipelineRun,
} from './csvPipelineStatus'

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

describe('derivePhase', () => {
  it('returns idle when nothing has ever run', () => {
    expect(derivePhase(null, null)).toEqual({ phase: 'idle' })
  })

  it('returns importing when bunk_requests sync is running', () => {
    const sync: SyncJobStatus = { name: 'bunk_requests', status: 'running', startedAt: ago(1) }
    expect(derivePhase(sync, null).phase).toBe('importing')
  })

  it('returns matching when sync completed but no debug row yet', () => {
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'completed',
      startedAt: ago(5),
      finishedAt: ago(2),
    }
    expect(derivePhase(sync, null).phase).toBe('matching')
  })

  it('returns matching when debug row exists but is older than current sync', () => {
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'completed',
      startedAt: ago(5),
      finishedAt: ago(2),
    }
    const stale: DebugPipelineRun = {
      run_id: 'old',
      created: ago(60),
      status_breakdown: { status_resolved: 1, status_pending: 0, status_declined: 0 },
    }
    expect(derivePhase(sync, stale).phase).toBe('matching')
  })

  it('returns done with counts when fresh debug row exists', () => {
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'completed',
      startedAt: ago(5),
      finishedAt: ago(3),
    }
    const fresh: DebugPipelineRun = {
      run_id: 'r1',
      created: ago(1),
      status_breakdown: { status_resolved: 20, status_pending: 6, status_declined: 2 },
    }
    const result = derivePhase(sync, fresh)
    expect(result.phase).toBe('done')
    expect(result).toMatchObject({
      counts: { total: 28, autoMatched: 22, needReview: 6 },
      runId: 'r1',
    })
  })

  it('returns error on failed sync with no orphan grace recovery', () => {
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'failed',
      startedAt: ago(60),
      finishedAt: ago(40),
      error: 'context deadline exceeded',
    }
    expect(derivePhase(sync, null).phase).toBe('error')
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
      status_breakdown: { status_resolved: 5, status_pending: 1, status_declined: 0 },
    }
    expect(derivePhase(sync, orphan).phase).toBe('done')
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
      status_breakdown: { status_resolved: 1, status_pending: 0, status_declined: 0 },
    }
    expect(derivePhase(sync, tooLate).phase).toBe('error')
  })

  it('treats exactly 30-min delta as done (inclusive boundary)', () => {
    // finishedAt 60 min ago, debug created 30 min ago → delta = 30 min
    const sync: SyncJobStatus = {
      name: 'bunk_requests',
      status: 'failed',
      startedAt: ago(90),
      finishedAt: ago(60),
      error: 'context deadline exceeded',
    }
    const debug: DebugPipelineRun = {
      run_id: 'r-boundary',
      created: ago(30),
      status_breakdown: { status_resolved: 1, status_pending: 0, status_declined: 0 },
    }
    expect(derivePhase(sync, debug).phase).toBe('done')
  })

  it('treats just past 30-min delta as error (exclusive past boundary)', () => {
    // finishedAt 60 min ago, debug created 29.99 min ago → delta = 30.01 min
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
      status_breakdown: { status_resolved: 1, status_pending: 0, status_declined: 0 },
    }
    expect(derivePhase(sync, debug).phase).toBe('error')
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
      status_breakdown: { status_resolved: 0, status_pending: 0, status_declined: 0 },
    }
    const result = derivePhase(sync, dedup)
    expect(result.phase).toBe('done')
    expect(result).toMatchObject({ counts: { total: 0, autoMatched: 0, needReview: 0 } })
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
    } as Response)
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
    } as Response)
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
    } as Response)
    const res = await fetchSyncStatus(mock)
    expect(res?.status).toBe('failed')
    expect(res?.error).toBe('context deadline exceeded')
  })

  it('returns null when bunk_requests entry is idle', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bunk_requests: { status: 'idle' } }),
    } as Response)
    expect(await fetchSyncStatus(mock)).toBeNull()
  })

  it('returns null when bunk_requests entry is missing entirely', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _daily_sync_running: false }),
    } as Response)
    expect(await fetchSyncStatus(mock)).toBeNull()
  })

  it('throws on non-ok response', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
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
    } as Response)
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
    } as Response)
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
            status_breakdown: { status_resolved: 5, status_pending: 1, status_declined: 0 },
            year: 2026,
            trace_count: 6,
          },
        ],
        totalItems: 1,
      }),
    } as Response)
    const res = await fetchLatestDebugRun(mock)
    expect(res).toEqual({
      run_id: 'run-abc',
      created: '2026-04-27T19:05:00Z',
      status_breakdown: { status_resolved: 5, status_pending: 1, status_declined: 0 },
    })
  })

  it('returns null when items array is empty', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)
    expect(await fetchLatestDebugRun(mock)).toBeNull()
  })

  it('throws on non-ok response', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(fetchLatestDebugRun(mock)).rejects.toThrow()
  })
})
