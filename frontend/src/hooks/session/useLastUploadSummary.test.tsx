import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

const auth = vi.hoisted(() => ({ isAuthLoading: false }))
vi.mock('../useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthLoading: auth.isAuthLoading }),
}))
vi.mock('../../services/csvPipelineStatus', async () => {
  const actual = await vi.importActual<typeof import('../../services/csvPipelineStatus')>(
    '../../services/csvPipelineStatus'
  )
  return { ...actual, fetchLatestUploadRun: vi.fn() }
})
vi.mock('../../services/sessionUploadChanges', async () => {
  const actual = await vi.importActual<typeof import('../../services/sessionUploadChanges')>(
    '../../services/sessionUploadChanges'
  )
  return { ...actual, fetchSessionUploadChanges: vi.fn() }
})

import { fetchLatestUploadRun } from '../../services/csvPipelineStatus'
import {
  fetchSessionUploadChanges,
  type UploadChangeRow,
} from '../../services/sessionUploadChanges'
import { useLastUploadSummary } from './useLastUploadSummary'

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const mockRun = (v: unknown) =>
  (fetchLatestUploadRun as ReturnType<typeof vi.fn>).mockResolvedValue(v)
const mockChanges = (v: UploadChangeRow[]) =>
  (fetchSessionUploadChanges as ReturnType<typeof vi.fn>).mockResolvedValue(v)

const changeRow = (session_cm_id: number, final_status: string): UploadChangeRow => ({
  requester_cm_id: 1,
  requester_name: 'Emma Johnson',
  target_name: 'Olivia Chen',
  request_type: 'bunk_with',
  final_status,
  session_cm_id,
})

beforeEach(() => {
  vi.clearAllMocks()
  auth.isAuthLoading = false
})

describe('useLastUploadSummary', () => {
  it('does not fetch while auth is still loading (frontend/CLAUDE.md auth gate)', async () => {
    auth.isAuthLoading = true
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
    })
    mockChanges([changeRow(1000001, 'RESOLVED')])
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    // Let any (incorrectly) enabled query microtask flush.
    await Promise.resolve()
    expect(fetchLatestUploadRun).not.toHaveBeenCalled()
    expect(fetchSessionUploadChanges).not.toHaveBeenCalled()
    expect(result.current.runId).toBeNull()
  })

  it('returns all-null while data is loading / no run returned, and never queries session changes', async () => {
    mockRun(null)
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBeNull())
    expect(result.current.finishedAt).toBeNull()
    expect(result.current.global).toBeNull()
    expect(result.current.session).toBeNull()
    // No runId ever resolved, so the session-changes query must stay disabled
    // rather than firing with an empty-string runId.
    expect(fetchSessionUploadChanges).not.toHaveBeenCalled()
  })

  // kindred#1713 Part 1: mirrors a real production slice (data-prod.db, the
  // 2026-08-19 upload run, session 1235404) where one DECLINED trace's
  // `disposition.final_bunk_requests` expanded to 4 rows in
  // debug_pipeline_summary (1 DECLINED + 3 RESOLVED). The old session_breakdown
  // trace count said "1 new"; the modal — and now the chip — counts the 4
  // actual requests.
  it('derives the session count from debug_pipeline_summary rows, not session_breakdown traces', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 20, pending: 3, declined: 1 },
    })
    mockChanges([
      changeRow(1235404, 'DECLINED'),
      changeRow(1235404, 'RESOLVED'),
      changeRow(1235404, 'RESOLVED'),
      changeRow(1235404, 'RESOLVED'),
    ])
    const { result } = renderHook(() => useLastUploadSummary(1235404, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.session).not.toBeNull())
    expect(result.current.session).toEqual({ total: 4, autoMatched: 4, needReview: 0 })
    expect(fetchSessionUploadChanges).toHaveBeenCalledWith('r1', [1235404], expect.any(Function))
    // global is untouched by Part 1 — still trace-grain from status_breakdown.
    expect(result.current.global).toEqual({ total: 24, autoMatched: 21, needReview: 3 })
    expect(result.current.runId).toBe('r1')
    expect(result.current.finishedAt).toBe('t')
  })

  it('needReview counts PENDING rows the same way the modal review badge does', async () => {
    mockRun({
      run_id: 'r5',
      created: 't5',
      status_breakdown: { resolved: 1, pending: 1, declined: 0 },
    })
    mockChanges([changeRow(1000001, 'PENDING'), changeRow(1000001, 'RESOLVED')])
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.session).not.toBeNull())
    expect(result.current.session).toEqual({ total: 2, autoMatched: 1, needReview: 1 })
  })

  it('queries the session cm_id and its AG session cm_ids together, in one call', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 20, pending: 3, declined: 1 },
    })
    mockChanges([
      changeRow(1000001, 'RESOLVED'),
      changeRow(1000001, 'RESOLVED'),
      changeRow(1000099, 'RESOLVED'), // AG-linked session
      changeRow(1000099, 'PENDING'),
      changeRow(1000099, 'PENDING'),
    ])
    const { result } = renderHook(() => useLastUploadSummary(1000001, [1000099]), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.session).not.toBeNull())
    expect(fetchSessionUploadChanges).toHaveBeenCalledWith(
      'r1',
      [1000001, 1000099],
      expect.any(Function)
    )
    expect(result.current.session).toEqual({ total: 5, autoMatched: 3, needReview: 2 })
  })

  it('uses only sessionCmId when agSessionCmIds is empty', async () => {
    mockRun({
      run_id: 'r2',
      created: 'ts2',
      status_breakdown: { resolved: 10, pending: 1, declined: 2 },
    })
    mockChanges([changeRow(1000001, 'RESOLVED')])
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.session).not.toBeNull())
    expect(fetchSessionUploadChanges).toHaveBeenCalledWith('r2', [1000001], expect.any(Function))
  })

  it('returns null session when fetchSessionUploadChanges returns no rows for this session', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
    })
    mockChanges([])
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    // Wait for the actual session-changes call, not just runId — session is
    // null before that query ever fires too, so asserting only on runId would
    // pass even if the query were disabled or never invoked.
    await waitFor(() =>
      expect(fetchSessionUploadChanges).toHaveBeenCalledWith('r1', [1000001], expect.any(Function))
    )
    expect(result.current.session).toBeNull()
  })

  it('returns null session and never queries session changes when sessionCmId is undefined', async () => {
    mockRun({
      run_id: 'r3',
      created: 'ts3',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
    })
    const { result } = renderHook(() => useLastUploadSummary(undefined, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r3'))
    expect(result.current.session).toBeNull()
    expect(fetchSessionUploadChanges).not.toHaveBeenCalled()
  })
})
