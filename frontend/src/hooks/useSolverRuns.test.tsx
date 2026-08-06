import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSolverRuns } from './useSolverRuns'

const mockGetList = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'r1',
      run_id: 'run_abc',
      stats: { status: 'OPTIMAL' },
      details: { git_sha: 'abc', source_label: '2 · CM' },
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
    // Mimic PB's filter param-substitution so tests can assert against the
    // resolved string (matches the real client's `{:key}` → quoted value).
    filter: (raw: string, params?: Record<string, unknown>) => {
      if (!params) return raw
      return Object.entries(params).reduce((acc, [k, v]) => {
        const replacement = typeof v === 'string' ? `"${v}"` : String(v)
        return acc.split(`{:${k}}`).join(replacement)
      }, raw)
    },
  },
}))

let qc: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('useSolverRuns', () => {
  it('passes through pre-parsed stats and details objects from PB', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const items = result.current.data?.pages.flatMap((p) => p.items) ?? []
    expect(items[0]?.stats?.status).toBe('OPTIMAL')
    expect(items[0]?.details?.git_sha).toBe('abc')
    expect(items[0]?.error).toBeNull()
  })

  it('scopes to year when filters.year is provided (#1247)', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ year: 2026 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter).toContain('year = 2026')
  })

  it('passes no year filter when filters.year is undefined', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter ?? '').not.toContain('year =')
  })

  it('concatenates pages via useInfiniteQuery (#1254)', async () => {
    mockGetList.mockClear()
    // Page 1: 100 items, totalItems: 150
    // Page 2: 50 items, totalItems: 150
    mockGetList.mockImplementation((page: number) => {
      if (page === 1) {
        return Promise.resolve({
          items: Array.from({ length: 100 }, (_, i) => ({
            id: `r${i}`,
            run_id: `run_${i}`,
            status: 'success',
            created: '2026-01-01T00:00:00Z',
            stats: null,
            details: null,
            error: null,
          })),
          totalItems: 150,
        })
      }
      return Promise.resolve({
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `r${100 + i}`,
          run_id: `run_${100 + i}`,
          status: 'success',
          created: '2026-01-01T00:00:00Z',
          stats: null,
          details: null,
          error: null,
        })),
        totalItems: 150,
      })
    })

    const { result } = renderHook(() => useSolverRuns({}), { wrapper })

    // After page 1, hasNextPage should be true
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)

    // Fetch page 2
    void result.current.fetchNextPage()

    // Wait until all 150 items are loaded
    await waitFor(() => {
      const allItems = result.current.data?.pages.flatMap((p) => p.items) ?? []
      expect(allItems).toHaveLength(150)
    })

    // After page 2, should have no more pages
    const allItems = result.current.data?.pages.flatMap((p) => p.items) ?? []
    expect(allItems).toHaveLength(150)
    expect(result.current.hasNextPage).toBe(false)

    // Restore default mock
    mockGetList.mockResolvedValue({
      items: [
        {
          id: 'r1',
          run_id: 'run_abc',
          stats: { status: 'OPTIMAL' },
          details: { git_sha: 'abc', source_label: '2 · CM' },
          error: null,
        },
      ],
      totalItems: 1,
    })
  })

  it('applies sourceKind filter against details.source_kind', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ sourceKind: 'production' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter).toContain('details.source_kind = "production"')
  })

  it('does not apply sourceKind when set to "all"', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ sourceKind: 'all' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter ?? '').not.toContain('source_kind')
  })

  it('applies sweepId filter against details.sweep_id', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ sweepId: 'sw_abc' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter).toContain('details.sweep_id = "sw_abc"')
  })

  it('applies manualOnly as null/empty check on details.sweep_id', async () => {
    mockGetList.mockClear()
    const { result } = renderHook(() => useSolverRuns({ manualOnly: true }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = mockGetList.mock.calls[0]?.[2] as { filter?: string } | undefined
    expect(opts?.filter).toMatch(/details\.sweep_id\s*=\s*(""|null)/)
  })
})
