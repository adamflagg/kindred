/** The compare and the trail reads: through fetchWithAuth, each view setting in the query (D38, D138). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { TRAIL, compareOut } from '../../components/camperships/season/scenarios/scenarioFixtures'
import type { AidRequestSet, CompareQuery } from '../../services/camperships/aidApi'
import { useAidScenarioCompare, useAidScenarioTrail } from './useAidScenarioCompare'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
let authLoading = false
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: authLoading, user: { id: 'u1' } }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  authLoading = false
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

const ask = (
  codes: readonly string[],
  requestSet: AidRequestSet,
  lastSeason: boolean
): CompareQuery => ({
  codes,
  requestSet,
  lastSeason,
  rules: false,
  lastRules: false,
  draft: true,
})

const url = () => (fetchSpy.mock.calls[0] as [string, RequestInit])[0]

describe('useAidScenarioCompare', () => {
  it('keeps the previous answer showing, marked as a placeholder, while a new tick loads (I1)', async () => {
    const { result, rerender } = renderHook(
      ({ codes }: { codes: readonly string[] }) =>
        useAidScenarioCompare(ask(codes, { kind: 'all' }, false)),
      { wrapper, initialProps: { codes: ['A'] as readonly string[] } }
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    fetchSpy.mockImplementation(() => new Promise<Response>(() => undefined))
    rerender({ codes: ['A', 'B'] })
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data).toBeDefined()
  })

  it('asks for each ticked option, the deadline switch and last season', async () => {
    renderHook(() => useAidScenarioCompare(ask(['A1', 'B'], { kind: 'deadline' }, true)), {
      wrapper,
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(url()).toBe(
      '/api/financial-aid/scenarios/2027/compare?codes=A1&codes=B&through_round1_deadline=true&last_season=true'
    )
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('asks for a received-through date, and nothing more for the plain draft', async () => {
    renderHook(() => useAidScenarioCompare(ask([], { kind: 'date', date: '2027-02-01' }, false)), {
      wrapper,
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(url()).toBe('/api/financial-aid/scenarios/2027/compare?received_through=2027-02-01')
  })

  it('asks for the built-in columns, and leaves the draft out only when told (§S11.2)', async () => {
    renderHook(
      () =>
        useAidScenarioCompare({
          codes: ['B', 'A'],
          requestSet: { kind: 'date', date: '2027-02-01' },
          lastSeason: true,
          rules: true,
          lastRules: true,
          draft: false,
        }),
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(url()).toBe(
      '/api/financial-aid/scenarios/2027/compare?codes=B&codes=A&received_through=2027-02-01&last_season=true&rules=true&last_rules=true&draft=false'
    )
  })
})

describe('useAidScenarioTrail paging', () => {
  it('keeps the page showing, as a placeholder, while the next one loads', async () => {
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useAidScenarioTrail(page),
      {
        wrapper,
        initialProps: { page: 1 },
      }
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    fetchSpy.mockImplementation(() => new Promise<Response>(() => undefined))
    rerender({ page: 2 })
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data).toBeDefined()
  })
})

describe('useAidScenarioTrail', () => {
  it('reads a page of 50, newest first', async () => {
    const { result } = renderHook(() => useAidScenarioTrail(2), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TRAIL))
    expect(url()).toBe('/api/financial-aid/scenarios/2027/trail?page=2&per_page=50')
  })
})

describe('the gates and the refusals both reads share', () => {
  const refuse = (status: number) =>
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'No deadline yet' }), { status }))
    )

  it.each([404, 422])('answers a %i at once, without the client retrying it', async (status) => {
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    refuse(status)
    const compare = renderHook(() => useAidScenarioCompare(ask([], { kind: 'deadline' }, false)), {
      wrapper,
    })
    const trail = renderHook(() => useAidScenarioTrail(1), { wrapper })
    await waitFor(() => expect(compare.result.current.isError).toBe(true))
    await waitFor(() => expect(trail.result.current.isError).toBe(true))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('sends the trail through fetchWithAuth too', async () => {
    const { result } = renderHook(() => useAidScenarioTrail(1), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TRAIL))
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('waits for auth to settle before asking', async () => {
    authLoading = true
    const compare = renderHook(() => useAidScenarioCompare(ask([], { kind: 'all' }, false)), {
      wrapper,
    })
    const trail = renderHook(() => useAidScenarioTrail(1), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(compare.result.current.fetchStatus).toBe('idle')
    expect(trail.result.current.fetchStatus).toBe('idle')
  })
})
