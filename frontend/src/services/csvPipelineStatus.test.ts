import { describe, it, expect } from 'vitest'
import { derivePhase, type SyncJobStatus, type DebugPipelineRun } from './csvPipelineStatus'

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
