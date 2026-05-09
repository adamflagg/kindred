import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useSolverRuns } from './useSolverRuns'

const mockGetList = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'r1',
      run_id: 'run_abc',
      stats: { status: 'OPTIMAL' },
      details: { git_sha: 'abc', source_label: 'S2 · Production' },
      error: null,
    },
  ],
  totalItems: 1,
})

// PocketBase JS SDK returns JSON-typed fields as already-parsed values
// (objects/arrays/primitives), NOT as JSON strings — matches how every other
// JSON-field hook in this repo (e.g. useSyncStatus.result_summary) consumes
// them.
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getList: (...args: unknown[]) => mockGetList(...args),
    }),
    filter: (raw: string) => raw,
  },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useSolverRuns', () => {
  it('passes through pre-parsed stats and details objects from PB', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.stats?.status).toBe('OPTIMAL')
    expect(result.current.data?.items[0]?.details?.git_sha).toBe('abc')
    expect(result.current.data?.items[0]?.error).toBeNull()
  })

  it('scopes to validSessionIds when provided (year-scope, since solver_runs has no year column)', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ validSessionIds: [1000001, 1000002] }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter).toContain('session_id = 1000001')
    expect(opts?.filter).toContain('session_id = 1000002')
  })

  it('returns an empty list immediately when validSessionIds is an empty array', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ validSessionIds: [] }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toEqual([])
    expect(result.current.data?.totalItems).toBe(0)
    // Critical: must NOT call PB at all — that would return cross-year rows.
    expect(mockGetList).not.toHaveBeenCalled()
  })
})
