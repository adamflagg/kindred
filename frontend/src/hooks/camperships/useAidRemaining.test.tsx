/**
 * useAidRemaining: the Remaining line's one small read (D48, spec §7.3). `useApiWithAuth` is
 * deliberately NOT mocked: the header assertion reads what reaches the network, which is what
 * proves the PocketBase JWT travels (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidRemaining } from '../../types/api-types'
import { useAidRemaining } from './useAidRemaining'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
const auth = { value: { isLoading: false, user: { id: 'u1' } } }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.value }))
let granted: string[] = ['financial_aid.view']
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let year = 2027
vi.mock('../useCurrentYear', () => ({ useYear: () => year }))

const PAYLOAD: ApiAidRemaining = {
  year: 2027,
  pools: [
    { pool: 'pool_a', label: 'Pool A', remaining: 153400 },
    { pool: 'pool_b', label: 'Pool B', remaining: -1200 },
  ],
  total: 152200,
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let route = '/aid/requests'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.value = { isLoading: false, user: { id: 'u1' } }
  granted = ['financial_aid.view']
  year = 2027
  route = '/aid/requests'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

describe('useAidRemaining', () => {
  it('sends the protected read through fetchWithAuth, carrying the PocketBase JWT', async () => {
    renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/remaining')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("returns the server's pools", async () => {
    const { result } = renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(PAYLOAD))
  })

  it("asks for the page's past day, and the recorded axis when the link names it", async () => {
    route = '/aid/requests?as_of=2026-04-01&as_of_axis=recorded'
    renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/financial-aid/decisions/2027/remaining?as_of=2026-04-01&as_of_axis=recorded'
    )
  })

  it('reads live when the link carries a date that is not a past day (Review Focus 1)', async () => {
    route = '/aid/requests?as_of=2026-13-01'
    renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/financial-aid/decisions/2027/remaining')
  })

  it('reads for a summary-only user too (D75)', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('withholds the read while auth loads, and for someone who cannot open Camperships', async () => {
    auth.value = { isLoading: true, user: { id: 'u1' } }
    const { rerender } = renderHook(() => useAidRemaining(), { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    auth.value = { isLoading: false, user: { id: 'u1' } }
    granted = []
    rerender()
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Ruling 2026-10-01 (plan review): the season is 0 until the backend's year config arrives
  // (CurrentYearContext); a read for year 0 would only 422. useAdminSessions guards the same way.
  it('waits for the season before reading', async () => {
    year = 0
    renderHook(() => useAidRemaining(), { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps a refusal's status, so a surface can tell 403 from a fault", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Permission denied' }), { status: 403 })
      )
    )
    const { result } = renderHook(() => useAidRemaining(), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatchObject({ status: 403, message: 'Permission denied' })
  })
})
