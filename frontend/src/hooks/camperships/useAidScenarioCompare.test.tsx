/** The compare and the trail reads: through fetchWithAuth, each view setting in the query (D38, D138). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { TRAIL, compareOut } from '../../components/camperships/season/scenarios/scenarioFixtures'
import { useAidScenarioCompare, useAidScenarioTrail } from './useAidScenarioCompare'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
    Promise.resolve(
      new Response(JSON.stringify(String(input).includes('/trail') ? TRAIL : compareOut()), {
        status: 200,
      })
    )
  )
})
afterEach(() => fetchSpy.mockRestore())

const url = () => (fetchSpy.mock.calls[0] as [string, RequestInit])[0]

describe('useAidScenarioCompare', () => {
  it('asks for each ticked option, the deadline switch and last season', async () => {
    renderHook(() => useAidScenarioCompare(['A1', 'B'], { kind: 'deadline' }, true), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(url()).toBe(
      '/api/financial-aid/scenarios/2027/compare?codes=A1&codes=B&through_round1_deadline=true&last_season=true'
    )
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('asks for a received-through date, and nothing more for the plain draft', async () => {
    renderHook(() => useAidScenarioCompare([], { kind: 'date', date: '2027-02-01' }, false), {
      wrapper,
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(url()).toBe('/api/financial-aid/scenarios/2027/compare?received_through=2027-02-01')
  })
})

describe('useAidScenarioTrail', () => {
  it('reads a page of 50, newest first', async () => {
    const { result } = renderHook(() => useAidScenarioTrail(2), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TRAIL))
    expect(url()).toBe('/api/financial-aid/scenarios/2027/trail?page=2&per_page=50')
  })
})
