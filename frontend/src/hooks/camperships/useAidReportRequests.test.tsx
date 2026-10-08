/**
 * useAidReportRequests: the requests behind one Reports count (slice 4 J; #2974's routes), on the
 * grid's as-of. `useApiWithAuth` is NOT mocked: the header assertion reads what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidReportRequests } from './useAidReportRequests'

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

const IDS = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  figures_on: '2027-04-10',
  request_set: null,
  request_ids: ['reqemma00000001'],
}
const ADDRESS = {
  report: 'statistics' as const,
  query: { part: 'tier', tier: '1', count: 'apps', round: '1' },
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let path = '/aid/requests'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.view']
  path = '/aid/requests'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(IDS), { status: 200 })))
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidReportRequests', () => {
  it("reads the count's requests through fetchWithAuth, carrying the PocketBase JWT", async () => {
    const { result } = renderHook(() => useAidReportRequests(ADDRESS), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(IDS))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      '/api/financial-aid/reports/2027/statistics/requests?part=tier&tier=1&count=apps&round=1'
    )
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("reads on the grid's own past date, so the ids and the rows are the same day", async () => {
    path = '/aid/requests?as_of=2027-03-08'
    renderHook(() => useAidReportRequests(ADDRESS), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('&as_of=2027-03-08')
  })

  it('reads nothing with no count in the URL, or without view (D65)', async () => {
    renderHook(() => useAidReportRequests(null), { wrapper })
    granted = ['financial_aid.summary']
    renderHook(() => useAidReportRequests(ADDRESS), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
