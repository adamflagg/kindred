/**
 * useAidStatistics: Reports › Statistics' one read (spec §9.2; D21). `useApiWithAuth` is NOT
 * mocked: the header assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { readStatisticsChoice } from '../../components/camperships/reports/reportParams'
import { STATISTICS } from '../../components/camperships/reports/statisticsFixtures'
import { useAidStatistics } from './useAidStatistics'

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
let path = '/aid/reports/statistics'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

const ALL = readStatisticsChoice(new URLSearchParams(''))
const CAMP_R2 = readStatisticsChoice(new URLSearchParams('table=camp&round=2&through=deadline'))

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.view']
  path = '/aid/reports/statistics'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(STATISTICS), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidStatistics', () => {
  it('reads the season through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidStatistics(ALL), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(STATISTICS))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/statistics?round=1')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("sends the chips, the deadline switch and the page's past date", async () => {
    path = '/aid/reports/statistics?as_of=2027-03-08'
    renderHook(() => useAidStatistics(CAMP_R2), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      '/api/financial-aid/reports/2027/statistics?table=camp&round=2&through_round1_deadline=true&as_of=2027-03-08'
    )
  })

  it('reads nothing without view (a summary-only user never reaches Statistics, D65)', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidStatistics(ALL), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("shows a refusal at once, never retried (a control the season can't take)", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ detail: 'The reporting controls work from 2027: every 2026 request…' }),
          { status: 422 }
        )
      )
    )
    const { result } = renderHook(() => useAidStatistics(CAMP_R2), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.current.error?.message).toContain('work from 2027')
  })
})
