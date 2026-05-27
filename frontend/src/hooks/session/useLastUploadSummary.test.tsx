import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('../useApiWithAuth', () => ({ useApiWithAuth: () => ({ fetchWithAuth: vi.fn() }) }))
vi.mock('../../services/csvPipelineStatus', async () => {
  const actual = await vi.importActual<typeof import('../../services/csvPipelineStatus')>(
    '../../services/csvPipelineStatus'
  )
  return { ...actual, fetchLatestUploadRun: vi.fn() }
})

import { fetchLatestUploadRun } from '../../services/csvPipelineStatus'
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useLastUploadSummary', () => {
  it('returns all-null while data is loading / no run returned', async () => {
    mockRun(null)
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBeNull())
    expect(result.current.finishedAt).toBeNull()
    expect(result.current.global).toBeNull()
    expect(result.current.session).toBeNull()
  })

  it('sums session cm_id + AG keys', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 20, pending: 3, declined: 1 },
      session_breakdown: {
        '1000001': { resolved: 8, pending: 2, declined: 0 },
        '1000099': { resolved: 3, pending: 1, declined: 0 }, // AG-linked
        '1000002': { resolved: 9, pending: 0, declined: 1 },
      },
    })
    const { result } = renderHook(() => useLastUploadSummary(1000001, [1000099]), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.session).not.toBeNull())
    // 1000001: resolved 8, pending 2, declined 0 → autoMatched 8, needReview 2
    // 1000099: resolved 3, pending 1, declined 0 → autoMatched 3, needReview 1
    // sum: resolved 11, pending 3, declined 0 → autoMatched 11, needReview 3, total 14
    expect(result.current.session).toEqual({ total: 14, autoMatched: 11, needReview: 3 })
    // global: resolved 20, pending 3, declined 1 → autoMatched 21, needReview 3, total 24
    expect(result.current.global).toEqual({ total: 24, autoMatched: 21, needReview: 3 })
    expect(result.current.runId).toBe('r1')
    expect(result.current.finishedAt).toBe('t')
  })

  it('returns null session slice when the session has no entries in session_breakdown', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
      session_breakdown: { '1000002': { resolved: 5, pending: 0, declined: 0 } },
    })
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r1'))
    expect(result.current.session).toBeNull()
  })

  it('returns null session when summed total is 0', async () => {
    mockRun({
      run_id: 'r1',
      created: 't',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
      session_breakdown: { '1000001': { resolved: 0, pending: 0, declined: 0 } },
    })
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r1'))
    expect(result.current.session).toBeNull()
  })

  it('uses only sessionCmId when agSessionCmIds is empty', async () => {
    mockRun({
      run_id: 'r2',
      created: 'ts2',
      status_breakdown: { resolved: 10, pending: 1, declined: 2 },
      session_breakdown: {
        '1000001': { resolved: 6, pending: 1, declined: 2 },
      },
    })
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r2'))
    // resolved 6, pending 1, declined 2 → autoMatched 8, needReview 1, total 9
    expect(result.current.session).toEqual({ total: 9, autoMatched: 8, needReview: 1 })
  })

  it('returns null session when sessionCmId is undefined', async () => {
    mockRun({
      run_id: 'r3',
      created: 'ts3',
      status_breakdown: { resolved: 5, pending: 0, declined: 0 },
      session_breakdown: { '1000001': { resolved: 5, pending: 0, declined: 0 } },
    })
    const { result } = renderHook(() => useLastUploadSummary(undefined, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r3'))
    expect(result.current.session).toBeNull()
  })

  it('handles missing session_breakdown gracefully', async () => {
    mockRun({
      run_id: 'r4',
      created: 'ts4',
      status_breakdown: { resolved: 5, pending: 2, declined: 0 },
      // no session_breakdown field
    })
    const { result } = renderHook(() => useLastUploadSummary(1000001, []), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.runId).toBe('r4'))
    expect(result.current.global).toEqual({ total: 7, autoMatched: 5, needReview: 2 })
    expect(result.current.session).toBeNull()
  })
})
