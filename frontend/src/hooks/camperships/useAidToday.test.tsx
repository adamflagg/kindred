/**
 * Today's one read (spec 2026-10-10 §9). `useApiWithAuth` is NOT mocked: the header assertion reads
 * what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidToday } from './useAidToday'

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

const TODAY_BODY = { year: 2027, casework: null, finance: null, development: [], stages: null }

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  granted = []
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(TODAY_BODY), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidToday', () => {
  it('reads /today/{year} through fetchWithAuth for development (grantors alone)', async () => {
    granted = ['financial_aid.grantors']
    const { result } = renderHook(() => useAidToday(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TODAY_BODY))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/today/2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without a Camperships permission', async () => {
    granted = []
    renderHook(() => useAidToday(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
