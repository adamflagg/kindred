/**
 * useRunOnDemandSync: the on-demand custom-values runs (Manage > Sync). Plan Review Focus 1:
 * while staff view the prior season, the run must read CampMinder for that season, so the
 * season reaches the URL -- but only when it is not the primary, so a primary run's request is
 * exactly what it always was.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { useRunOnDemandSync } from './useRunOnDemandSync'

const send = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: { send: (...args: unknown[]) => send(...args) as unknown },
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.syncStatus(), { _configured_year: 2027 })
  send.mockReset()
  send.mockResolvedValue({ status: 'started' })
})

describe('useRunOnDemandSync', () => {
  it('runs the season being viewed when it is not the primary', async () => {
    const { result } = renderHook(() => useRunOnDemandSync(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ syncType: 'person_custom_values', session: '1001', year: 2026 })
    )
    expect(send).toHaveBeenCalledWith(
      '/api/custom/sync/person-custom-values?session=1001&year=2026',
      {
        method: 'POST',
      }
    )
  })

  it('sends no year for the primary, or when none is given', async () => {
    const { result } = renderHook(() => useRunOnDemandSync(), { wrapper })
    await act(() => result.current.mutateAsync({ syncType: 'household_custom_values', year: 2027 }))
    await act(() => result.current.mutateAsync({ syncType: 'household_custom_values' }))
    expect(send).toHaveBeenNthCalledWith(1, '/api/custom/sync/household-custom-values', {
      method: 'POST',
    })
    expect(send).toHaveBeenNthCalledWith(2, '/api/custom/sync/household-custom-values', {
      method: 'POST',
    })
  })
})
