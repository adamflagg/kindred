/**
 * Roster hooks: keys come from the central factory, and the PHI query is
 * opt-in so it never fires for users who cannot see the narrative.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import {
  useHouseholdMedical,
  useWeekendRoster,
  useWeekendSessions,
  useWeekendSummary,
} from './useWeekendRoster'

const fetchWeekendSessions = vi.fn()
const fetchWeekendSummary = vi.fn()
const fetchWeekendRoster = vi.fn()
const fetchHouseholdMedical = vi.fn()

vi.mock('../services/lodgingApi', () => ({
  fetchWeekendSessions: (...args: unknown[]) => fetchWeekendSessions(...args),
  fetchWeekendSummary: (...args: unknown[]) => fetchWeekendSummary(...args),
  fetchWeekendRoster: (...args: unknown[]) => fetchWeekendRoster(...args),
  fetchHouseholdMedical: (...args: unknown[]) => fetchHouseholdMedical(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

/**
 * The app's real cache defaults (`utils/queryClient.ts`). The summer bunking
 * board's hooks — `hooks/session/useSessionData.ts` — set NO cache options at
 * all, so these are what summer actually runs on. Weekend must inherit them
 * too; see the "model summer" rule in CLAUDE.md.
 */
const APP_CACHE_DEFAULTS = {
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  refetchOnWindowFocus: false,
} as const

// One client per test, built in beforeEach rather than in the wrapper body —
// a client constructed during render is rebuilt on every render and forgets
// its cache between them, which is exactly what these tests inspect (#1944).
let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * The options React Query actually resolved for a mounted query, client
 * defaults merged in. Read from the OBSERVER, not the query: `staleTime` and
 * `refetchOnWindowFocus` are observer-level options and are absent from
 * `Query.options`, so asserting there would silently check nothing.
 */
function resolvedOptions(queryKey: readonly unknown[]) {
  const query = client.getQueryCache().find({ queryKey })
  if (!query) throw new Error(`no query cached for ${JSON.stringify(queryKey)}`)
  const observer = query.observers[0]
  if (!observer) throw new Error(`query ${JSON.stringify(queryKey)} has no mounted observer`)
  return observer.options
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, ...APP_CACHE_DEFAULTS } },
  })
  fetchWeekendSessions.mockReset().mockResolvedValue({ year: 2026, sessions: [] })
  fetchWeekendSummary.mockReset().mockResolvedValue({ year: 2026, weekends: [] })
  fetchWeekendRoster.mockReset().mockResolvedValue({ year: 2026, session_cm_id: 1000001 })
  fetchHouseholdMedical.mockReset().mockResolvedValue({ household_cm_id: 2000001, year: 2026 })
})

describe('cache parity with summer', () => {
  // Weekend previously opted down to `userDataOptions` — 30s stale, 5min gc,
  // refetch on focus — justified by "staff edit cabin assignments in
  // CampMinder while the page is open". Two things kill that justification.
  // Summer's board has exactly the same property and does NOT opt down. And a
  // weekend is worked by ONE person at a time, modelling scenarios for
  // themselves; a second staff member looking on is rare and read-shaped.
  // There is no concurrent-edit hazard to buy with short caching, so the
  // trade was all cost: a ~3s eleven-query roster rebuild every 30 seconds,
  // and a cache evicted entirely after five minutes away.
  //
  // The safety this gives up is REAL but belongs elsewhere: once drag
  // placement writes, its mutations must invalidate `weekendRoster` /
  // `weekendSummary` explicitly, the way summer's mutations do. Long
  // staleTime plus deliberate invalidation, not short staleTime plus hope.
  it('lets the roster inherit the app cache defaults, as the summer board does', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendRoster(2026, 1000001))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.gcTime).toBe(APP_CACHE_DEFAULTS.gcTime)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it('lets the session list inherit them', async () => {
    const { result } = renderHook(() => useWeekendSessions(2026), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendSessions(2026))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it('lets the lander summary inherit them', async () => {
    const { result } = renderHook(() => useWeekendSummary(2026), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendSummary(2026))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it('keeps PHI uncached, which is a DELIBERATE divergence and must survive', async () => {
    // The one weekend query that should not inherit: a medical narrative must
    // not sit in the cache after the panel closes.
    const { result } = renderHook(() => useHouseholdMedical(2026, 2000001, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.householdMedical(2026, 2000001))
    expect(options.staleTime).toBe(0)
    expect(options.gcTime).toBe(0)
  })
})

describe('queryKeys', () => {
  it('exposes stable lodging keys', () => {
    expect(queryKeys.weekendSessions(2026)).toEqual(['weekend-sessions', 2026])
    expect(queryKeys.weekendRoster(2026, 1000001)).toEqual(['weekend-roster', 2026, 1000001])
    expect(queryKeys.householdMedical(2026, 2000001)).toEqual(['household-medical', 2026, 2000001])
    expect(queryKeys.lodgingUnits()).toEqual(['lodging-units'])
    expect(queryKeys.lodgingAreas()).toEqual(['lodging-areas'])
    expect(queryKeys.lodgingAliases()).toEqual(['lodging-aliases'])
    expect(queryKeys.weekendSummary(2026)).toEqual(['weekend-summary', 2026])
    expect(queryKeys.lodgingIngestIssues()).toEqual(['lodging-ingest-issues'])
  })
})

describe('useWeekendSessions', () => {
  it('fetches the session list for the year', async () => {
    const { result } = renderHook(() => useWeekendSessions(2026), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendSessions).toHaveBeenCalledTimes(1)
    const [, year] = fetchWeekendSessions.mock.calls[0] as [unknown, number]
    expect(year).toBe(2026)
  })
})

describe('useWeekendSummary', () => {
  it('fetches the whole year once, which is the point of it', async () => {
    const { result } = renderHook(() => useWeekendSummary(2026), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendSummary).toHaveBeenCalledTimes(1)
    const [, year] = fetchWeekendSummary.mock.calls[0] as [unknown, number]
    expect(year).toBe(2026)
  })
})

describe('useWeekendRoster', () => {
  it('does not fetch until a session is chosen', () => {
    renderHook(() => useWeekendRoster(2026, null), { wrapper })
    expect(fetchWeekendRoster).not.toHaveBeenCalled()
  })

  it('fetches once a session is chosen', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [, year, sessionCmId] = fetchWeekendRoster.mock.calls[0] as [unknown, number, number]
    expect([year, sessionCmId]).toEqual([2026, 1000001])
  })
})

describe('useHouseholdMedical', () => {
  it('stays idle while disabled, so PHI is never fetched speculatively', () => {
    renderHook(() => useHouseholdMedical(2026, 2000001, false), { wrapper })
    expect(fetchHouseholdMedical).not.toHaveBeenCalled()
  })

  it('fetches only when explicitly enabled', async () => {
    const { result } = renderHook(() => useHouseholdMedical(2026, 2000001, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchHouseholdMedical).toHaveBeenCalledTimes(1)
  })
})
