import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn(() => Promise.resolve([{ session_cm_id: 1000209 }]))
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => (name === 'lodging_session_status' ? { getFullList } : null),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))

import { queryKeys } from '../../utils/queryKeys'
import { useLodgingCancelledSessions } from './useLodgingCancelledSessions'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useLodgingCancelledSessions (spec §5.3, open item 7)', () => {
  it("reads the lodging board's cancelled weekends as a set of session ids", async () => {
    const { result } = renderHook(() => useLodgingCancelledSessions(2027), { wrapper })
    await waitFor(() => expect(result.current).toEqual(new Set([1000209])))
    expect(getFullList).toHaveBeenCalledWith({
      filter: 'year = 2027 && status = "cancelled"',
      fields: 'session_cm_id',
    })
  })

  it("sits under the weekend-sessions prefix so the lodging board's write refreshes it", () => {
    expect(queryKeys.weekendSessionsCancelled(2027).slice(0, 1)).toEqual(
      queryKeys.weekendSessionsPrefix()
    )
  })
})

describe('useLodgingCancelledSessions: a direct PocketBase read under a shared prefix, so it names aidRetry itself', () => {
  // A client that would retry three times at once: only the hook's own rule stops it.
  const retrying = () =>
    new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
  const answered = (status: number) => Object.assign(new Error('x'), { status })

  it('reads a server fault once', async () => {
    const client = retrying()
    getFullList.mockClear()
    getFullList.mockImplementation(() => Promise.reject(answered(500)))
    renderHook(() => useLodgingCancelledSessions(2031), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.weekendSessionsCancelled(2031))?.status).toBe('error')
    )
    expect(getFullList).toHaveBeenCalledTimes(1)
  })

  it("retries a dropped connection (PocketBase's status 0) once", async () => {
    const client = retrying()
    getFullList.mockClear()
    getFullList.mockImplementation(() => Promise.reject(answered(0)))
    renderHook(() => useLodgingCancelledSessions(2031), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.weekendSessionsCancelled(2031))?.status).toBe('error')
    )
    expect(getFullList).toHaveBeenCalledTimes(2)
  })
})
