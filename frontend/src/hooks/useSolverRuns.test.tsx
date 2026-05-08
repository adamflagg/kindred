import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useSolverRuns } from './useSolverRuns'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getList: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'r1',
            run_id: 'run_abc',
            stats: '{"status":"OPTIMAL"}',
            details: '{"git_sha":"abc","source_label":"S2 · Production"}',
          },
        ],
        totalItems: 1,
      }),
    }),
  },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useSolverRuns', () => {
  it('parses stats and details JSON blobs into structured fields', async () => {
    const { result } = renderHook(() => useSolverRuns({}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0]?.stats?.status).toBe('OPTIMAL')
    expect(result.current.data?.items[0]?.details?.git_sha).toBe('abc')
  })
})
