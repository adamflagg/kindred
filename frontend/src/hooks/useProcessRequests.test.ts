/**
 * useProcessRequests: Manage > Sync's Process Requests options. Plan Review Focus 1: while staff
 * view the prior season, processing must run for that season, so the season reaches the URL --
 * only when it is not the primary, so a primary request is exactly what it always was.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessRequestOptionsState } from '../components/admin/ProcessRequestOptions'
import { queryKeys } from '../utils/queryKeys'
import { useProcessRequests } from './useProcessRequests'

const send = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: { send: (...args: unknown[]) => send(...args) as unknown },
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const OPTIONS: ProcessRequestOptionsState = {
  session: 'all',
  sessionLabel: 'All sessions',
  limit: undefined,
  forceReprocess: false,
  sourceFields: [],
  debug: false,
  trace: false,
  collectTraces: false,
}

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

describe('useProcessRequests', () => {
  it('processes the season being viewed when it is not the primary', async () => {
    const { result } = renderHook(() => useProcessRequests(), { wrapper })
    await act(() => result.current.mutateAsync({ ...OPTIONS, year: 2026 }))
    expect(send).toHaveBeenCalledWith('/api/custom/sync/process-requests?year=2026', {
      method: 'POST',
    })
  })

  it('sends no year for the primary', async () => {
    const { result } = renderHook(() => useProcessRequests(), { wrapper })
    await act(() => result.current.mutateAsync({ ...OPTIONS, year: 2027 }))
    expect(send).toHaveBeenCalledWith('/api/custom/sync/process-requests', { method: 'POST' })
  })
})
