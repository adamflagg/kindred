/**
 * useAidGrants and its fresh read (spec §8.2; P-9). `useApiWithAuth` is NOT mocked: the header
 * assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { GRANTS } from '../../components/camperships/grants/grantsFixtures'
import { useAidGrants, useFreshAidGrants } from './useAidGrants'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The stored-fields read: no round on any share (the router skips the pricing). */
const STORED = {
  ...GRANTS,
  grants: GRANTS.grants.map((g) => ({
    ...g,
    requests: g.requests.map((s) => ({ request_id: s.request_id, amount: s.amount })),
  })),
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
    Promise.resolve(
      new Response(JSON.stringify(String(url).includes('offsets=false') ? STORED : GRANTS), {
        status: 200,
      })
    )
  )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidGrants', () => {
  it('reads the season, priced, through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidGrants(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(GRANTS))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/grants/2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without view (development sees aggregates only, D57)', async () => {
    granted = ['financial_aid.grantors', 'financial_aid.summary']
    renderHook(() => useAidGrants(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the fresh read asks for the stored fields past a warm cache, and never replaces the Register’s priced read', async () => {
    const { result } = renderHook(() => ({ list: useAidGrants(), fresh: useFreshAidGrants() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.list.data).toEqual(GRANTS))
    let fresh: unknown
    await act(async () => {
      fresh = await result.current.fresh()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [url] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/grants/2027?offsets=false')
    expect(fresh).toEqual(STORED)
    // ⚠ The Register still shows each round its grants offset.
    await act(settle)
    expect(client.getQueryData(['financial-aid', 'grants', 2027, 'priced'])).toEqual(GRANTS)
    expect(result.current.list.data).toEqual(GRANTS)
  })
})
