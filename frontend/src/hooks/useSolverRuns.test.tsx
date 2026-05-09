import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useSolverRuns } from './useSolverRuns'

// PocketBase JS SDK returns JSON-typed fields as already-parsed values
// (objects/arrays/primitives), NOT as JSON strings — matches how every other
// JSON-field hook in this repo (e.g. useSyncStatus.result_summary) consumes
// them.
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getList: vi.fn().mockResolvedValue({
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
      }),
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
    const { result } = renderHook(() => useSolverRuns({}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.stats?.status).toBe('OPTIMAL')
    expect(result.current.data?.items[0]?.details?.git_sha).toBe('abc')
    expect(result.current.data?.items[0]?.error).toBeNull()
  })
})
