/**
 * useJotformPull (kindred#2828): the Jotform tab starts the pull the way the
 * Sync tab does (the individual-sync route), then watches the job's status and
 * refreshes the tab's forms and queue once THAT run has finished — a pull only
 * started would refresh nothing, because the job runs in the background.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { JOTFORM_SYNC_ID, useJotformPull } from './useJotformAdmin'

const send = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: {
    send: (...args: unknown[]) => send(...args) as unknown,
    authStore: { token: 'test-jwt', isValid: true, onChange: () => () => {}, clear: vi.fn() },
  },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { default: toast }
})

let client: QueryClient
let job: { status: string; end_time?: string }

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function jotformInvalidations(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter(
    (call: unknown[]) =>
      JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify(queryKeys.jotformPrefix())
  ).length
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  job = { status: 'success', end_time: '2026-09-24T08:00:00Z' }
  send.mockReset()
  send.mockImplementation((path: string) => {
    if (path === '/api/custom/sync/status') {
      return Promise.resolve({ [JOTFORM_SYNC_ID]: { ...job } })
    }
    return Promise.resolve({ status: 'started' })
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useJotformPull', () => {
  it('starts the Jotform job and refreshes the tab only once that run finishes', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useJotformPull(), { wrapper })
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('/api/custom/sync/status', expect.anything())
    )

    await act(async () => {
      await result.current.pull()
    })
    expect(send).toHaveBeenCalledWith('/api/custom/sync/jotform-submissions', { method: 'POST' })
    expect(result.current.isPulling).toBe(true)

    // Still the previous run's end: nothing is refreshed yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(jotformInvalidations(invalidate)).toBe(0)

    job = { status: 'running', end_time: '2026-09-24T08:00:00Z' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(jotformInvalidations(invalidate)).toBe(0)

    job = { status: 'success', end_time: '2026-09-24T09:00:00Z' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    await waitFor(() => expect(jotformInvalidations(invalidate)).toBe(1))
    expect(result.current.isPulling).toBe(false)
  })

  it('does not watch a pull the server refused', async () => {
    send.mockImplementation((path: string) =>
      path === '/api/custom/sync/status'
        ? Promise.resolve({ [JOTFORM_SYNC_ID]: { ...job } })
        : Promise.reject(new Error('Jotform Submissions sync is already running.'))
    )
    const { result } = renderHook(() => useJotformPull(), { wrapper })
    await act(async () => {
      await result.current.pull()
    })
    expect(result.current.isPulling).toBe(false)
  })
})
