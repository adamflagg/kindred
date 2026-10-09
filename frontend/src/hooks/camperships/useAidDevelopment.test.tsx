/**
 * Reports › Development's reads and the dated columns' write (spec §9.4; D65, D68). `useApiWithAuth`
 * is NOT mocked: the header assertion reads what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  DEVELOPMENT,
  DEVELOPMENT_LIVE,
} from '../../components/camperships/reports/developmentFixtures'
import { useAidDevelopment } from './useAidDevelopment'

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

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.summary']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('column=') ? DEVELOPMENT : DEVELOPMENT_LIVE),
          { status: 200 }
        )
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidDevelopment', () => {
  it('reads the report with summary alone (D65), through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidDevelopment(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DEVELOPMENT_LIVE))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/development')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without view or summary', async () => {
    granted = ['financial_aid.grantors']
    renderHook(() => useAidDevelopment(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('useAidDevelopment with an on-demand column (D1)', () => {
  const MARCH = { season: 2027, day: '2027-03-09' }

  it('asks for ?column=<season>:<day>, through fetchWithAuth, and keeps it apart from the live read', async () => {
    const live = renderHook(() => useAidDevelopment(), { wrapper })
    await waitFor(() => expect(live.result.current.data).toEqual(DEVELOPMENT_LIVE))
    const { result } = renderHook(() => useAidDevelopment(MARCH), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DEVELOPMENT))
    const [url, options] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/development?column=2027%3A2027-03-09')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(live.result.current.data).toEqual(DEVELOPMENT_LIVE)
  })

  it('writes nothing and reads no saved list', async () => {
    const { result } = renderHook(() => useAidDevelopment(MARCH), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DEVELOPMENT))
    for (const [url, options] of fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>) {
      expect(url).not.toContain('/columns')
      expect(options?.method ?? 'GET').toBe('GET')
    }
  })
})
