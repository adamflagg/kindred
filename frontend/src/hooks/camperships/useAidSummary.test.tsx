/** useAidSummary: the Ledger tab's posted totals (F10). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { SUMMARY } from '../../components/camperships/money/ledgerFixtures'
import { useAidSummary } from './useAidSummary'

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
let route = '/aid/money/ledger'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  route = '/aid/money/ledger'
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(SUMMARY), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

describe('useAidSummary', () => {
  it('reads the season live through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidSummary(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(SUMMARY))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/summary?year=2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("asks for the page's past day", async () => {
    route = '/aid/money/ledger?as_of=2027-05-01'
    renderHook(() => useAidSummary(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/financial-aid/summary?year=2027&as_of=2027-05-01'
    )
  })

  it('reads nothing without view (the route is view only)', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidSummary(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
