import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useRunSweep } from './useRunSweep'

vi.mock('../services/solver', () => ({
  postRunSweep: vi.fn().mockResolvedValue({ sweep_id: 'sw_1', run_ids: ['r1', 'r2'] }),
  postCancelSweep: vi.fn(),
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useRunSweep', () => {
  it('returns sweep_id and run_ids on success', async () => {
    const { result } = renderHook(() => useRunSweep(), { wrapper })
    await act(async () => {
      result.current.mutate({ session_cm_id: 1000002, year: 2026, time_budgets: [30, 60] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.sweep_id).toBe('sw_1')
    expect(result.current.data?.run_ids).toEqual(['r1', 'r2'])
  })
})
