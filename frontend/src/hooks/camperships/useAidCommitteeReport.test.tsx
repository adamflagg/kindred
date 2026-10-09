/** useAidCommitteeReport: the committee's year-over-year read (spec §9.7). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { COMMITTEE } from '../../components/camperships/reports/committeeFixtures'
import { useAidCommitteeReport } from './useAidCommitteeReport'

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
  client = new QueryClient()
  granted = ['financial_aid.view']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(COMMITTEE), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidCommitteeReport', () => {
  it('reads the seasons through fetchWithAuth, carrying the PocketBase JWT; live only', async () => {
    const { result } = renderHook(() => useAidCommitteeReport({ kind: 'all' }), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(COMMITTEE))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/committee')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("moves this season's cutoff with a received-through date", async () => {
    renderHook(() => useAidCommitteeReport({ kind: 'date', date: '2027-02-15' }), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/committee?received_through=2027-02-15')
  })

  it('reads nothing without view', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidCommitteeReport({ kind: 'all' }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
