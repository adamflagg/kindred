import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../contexts/AuthContext'
import { postRunSweep } from '../services/solver'
import { createMockAuthContext, createMockUser } from '../test/test-helpers'
import { useRunSweep } from './useRunSweep'

vi.mock('../services/solver', () => ({
  postRunSweep: vi.fn(),
  postCancelSweep: vi.fn(),
}))

let qc: QueryClient
let authCtx: ReturnType<typeof createMockAuthContext>

const wrapper = ({ children }: { children: ReactNode }) => {
  return (
    <AuthContext value={authCtx}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </AuthContext>
  )
}

const mockPostRunSweep = vi.mocked(postRunSweep)

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  authCtx = createMockAuthContext({ user: createMockUser() })
})

describe('useRunSweep', () => {
  it('returns sweep_id and run_ids on success', async () => {
    mockPostRunSweep.mockResolvedValueOnce({ sweep_id: 'sw_1', run_ids: ['r1', 'r2'] })
    const { result } = renderHook(() => useRunSweep(), { wrapper })
    await act(async () => {
      result.current.mutate({ session_cm_id: 1000002, year: 2026, time_budgets: [30, 60] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.sweep_id).toBe('sw_1')
    expect(result.current.data?.run_ids).toEqual(['r1', 'r2'])
  })

  it('surfaces the error on the mutation result so callers can show feedback', async () => {
    mockPostRunSweep.mockRejectedValueOnce(new Error('sweep failed: boom'))
    const { result } = renderHook(() => useRunSweep(), { wrapper })
    await act(async () => {
      result.current.mutate({ session_cm_id: 1000002, year: 2026, time_budgets: [30] })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('sweep failed: boom')
  })
})
