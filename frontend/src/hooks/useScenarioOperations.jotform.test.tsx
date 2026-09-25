/**
 * Renaming a scenario refreshes the weekend Requests tab (scan of #2839): the
 * tab names the scenario a filing's write-in is linked in ("linked in Plan
 * B"), so a rename must not leave the old name up for the cache's half hour.
 * Create and delete already invalidate the Jotform queries
 * (`useSavedScenariosMutation.test.ts`); this pins update.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { useUpdateScenario } from './useScenarioOperations'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      update: vi.fn(() => Promise.resolve({ id: 'sc001', name: 'Plan C' })),
    }),
  },
}))
vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn() }),
}))

describe('useUpdateScenario', () => {
  it('invalidates the Jotform queries after a rename', async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useUpdateScenario(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ scenarioId: 'sc001', updates: { name: 'Plan C' } })
    })
    const keys = invalidate.mock.calls.map(([arg]) => arg?.queryKey)
    expect(keys).toContainEqual(queryKeys.jotformPrefix())
  })
})
