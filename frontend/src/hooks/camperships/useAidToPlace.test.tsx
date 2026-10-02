/**
 * useAidToPlace: Money › To place's one read (spec §8.1; D21). `useApiWithAuth` is NOT mocked: the
 * header assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { TO_PLACE } from '../../components/camperships/money/toPlaceFixtures'
import { useAidToPlace } from './useAidToPlace'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = ['financial_aid.view']
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(TO_PLACE), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidToPlace', () => {
  it('reads the season through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidToPlace(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TO_PLACE))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/money/2027/to-place')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("scopes the read to one household's D26 scope", async () => {
    renderHook(() => useAidToPlace(1000001), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/money/2027/to-place?household_cm_id=1000001')
  })

  it('reads nothing without view', async () => {
    granted = ['financial_aid.grantors']
    renderHook(() => useAidToPlace(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
