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
 * `refetchOnWindowFocus` are observer-level options, absent from the
 * `QueryOptions` type that `Query.options` carries. Asserting there does not
 * silently pass — it fails typecheck — but the observer is where these
 * options actually resolve, so it is the honest place to read them.
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

describe('year gating', () => {
  // `CurrentYearContext` resolves the year from the backend and returns the
  // literal number 0 until it does (`CurrentYearContext.tsx:67-69`), exposing
  // an `isYearReady` flag for consumers to gate on. Neither weekend page
  // reads that flag, so without an `enabled` guard every one of these hooks
  // fires `?year=0` on cold load. The routers declare `ge=2000`
  // (`api/routers/lodging.py:64,77,99`), so that is a guaranteed 422 — and
  // `queryClient.ts` only skips retry on 401, so it is retried with backoff.
  // `enabled: year > 0` is the established convention at 14+ other hooks.
  it('does not fetch the session list before the year resolves', () => {
    renderHook(() => useWeekendSessions(0), { wrapper })
    expect(fetchWeekendSessions).not.toHaveBeenCalled()
  })

  it('does not fetch the summary before the year resolves', () => {
    renderHook(() => useWeekendSummary(0), { wrapper })
    expect(fetchWeekendSummary).not.toHaveBeenCalled()
  })

  it('does not fetch the roster before the year resolves, even with a session', () => {
    // The existing `enabled: sessionCmId !== null` guard does NOT cover this:
    // on a direct load of /weekend/1000001 the id is parsed synchronously off
    // the URL, deliberately, so it is non-null on the very first render while
    // the year is still 0. The guard was on the wrong axis.
    renderHook(() => useWeekendRoster(0, 1000001, ''), { wrapper })
    expect(fetchWeekendRoster).not.toHaveBeenCalled()
  })

  it('fetches once the year is real', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001, ''), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendRoster).toHaveBeenCalledTimes(1)
  })
})

describe('the scenario dimension', () => {
  it('passes the scenario down to the fetcher', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001, 'scn7x2k9qw3mnbv'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchWeekendRoster).toHaveBeenCalledWith(
      expect.anything(),
      2026,
      1000001,
      'scn7x2k9qw3mnbv'
    )
  })

  it('REFETCHES when the scenario changes rather than serving the mirror', async () => {
    // This is the whole point of the key change, and it fails silently
    // without it. Sharing one cache slot, selecting a scenario would resolve
    // instantly out of the mirror's cached entry — and with the app default
    // 30 minute staleTime, React Query would not refetch behind it. Staff
    // would select their draft and be shown the synced rows, indefinitely.
    const { result, rerender } = renderHook(
      ({ scenario }: { scenario: string }) => useWeekendRoster(2026, 1000001, scenario),
      { wrapper, initialProps: { scenario: '' } }
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendRoster).toHaveBeenCalledTimes(1)

    rerender({ scenario: 'scn7x2k9qw3mnbv' })
    await waitFor(() => expect(fetchWeekendRoster).toHaveBeenCalledTimes(2))
  })

  it('keeps two drafts of one weekend in SEPARATE slots', async () => {
    // Switching away and back is the part that proves "separate slots" rather
    // than merely "a key change refetches" — the assertion the rest of this
    // block already makes. Going back to A must serve A's own cached entry:
    // one fetch each, not three, and critically not A re-fetched because B
    // had overwritten it.
    const { result, rerender } = renderHook(
      ({ scenario }: { scenario: string }) => useWeekendRoster(2026, 1000001, scenario),
      { wrapper, initialProps: { scenario: 'scn7x2k9qw3mnbv' } }
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ scenario: 'scnp4d8sh1zjrtc' })
    await waitFor(() => expect(fetchWeekendRoster).toHaveBeenCalledTimes(2))

    rerender({ scenario: 'scn7x2k9qw3mnbv' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendRoster).toHaveBeenCalledTimes(2)
  })
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
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001, ''), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendRoster(2026, 1000001, ''))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.gcTime).toBe(APP_CACHE_DEFAULTS.gcTime)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it('lets the session list inherit them', async () => {
    const { result } = renderHook(() => useWeekendSessions(2026), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendSessions(2026))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.gcTime).toBe(APP_CACHE_DEFAULTS.gcTime)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it('lets the lander summary inherit them', async () => {
    const { result } = renderHook(() => useWeekendSummary(2026), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const options = resolvedOptions(queryKeys.weekendSummary(2026))
    expect(options.staleTime).toBe(APP_CACHE_DEFAULTS.staleTime)
    expect(options.gcTime).toBe(APP_CACHE_DEFAULTS.gcTime)
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
    expect(queryKeys.weekendRoster(2026, 1000001, '')).toEqual([
      'weekend-roster',
      2026,
      1000001,
      '',
    ])
    expect(queryKeys.householdMedical(2026, 2000001)).toEqual(['household-medical', 2026, 2000001])
    expect(queryKeys.lodgingUnits(2026)).toEqual(['lodging-units', 2026])
    expect(queryKeys.lodgingAreas(2026)).toEqual(['lodging-areas', 2026])
    expect(queryKeys.lodgingAliases()).toEqual(['lodging-aliases'])
    expect(queryKeys.weekendSummary(2026)).toEqual(['weekend-summary', 2026])
    expect(queryKeys.lodgingIngestIssues(2026)).toEqual(['lodging-ingest-issues', 2026])
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
    renderHook(() => useWeekendRoster(2026, null, ''), { wrapper })
    expect(fetchWeekendRoster).not.toHaveBeenCalled()
  })

  it('fetches once a session is chosen', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001, ''), { wrapper })

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
