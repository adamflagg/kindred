/**
 * React Query hooks for the weekend lodging roster.
 *
 * CACHING MODELS SUMMER, DELIBERATELY. These queries set no cache options, so
 * they inherit the app defaults in `utils/queryClient.ts` — exactly as the
 * summer bunking board's hooks do (`hooks/session/useSessionData.ts` sets
 * none either). Do not reintroduce a weekend-specific policy; see the
 * "model summer" rule in CLAUDE.md.
 *
 * These hooks previously used `userDataOptions` (30s stale, 5min gc, refetch
 * on focus), justified by staff editing cabin assignments in CampMinder while
 * the page is open. That justification did not survive contact with two facts.
 * Summer's board has the same property and does not opt down. And a weekend is
 * worked by ONE person at a time, modelling scenarios for themselves — a
 * second staff member is rare and read-shaped — so there is no concurrent-edit
 * hazard being bought. What it cost was real: `build_roster` issues eleven
 * PocketBase fetches, and `build_summary`'s docstring (which exists because
 * calling the roster per weekend repeated them) puts an empty weekend at about
 * three seconds, and that was being re-paid every 30 seconds of window focus,
 * with the cache dropped entirely after five minutes away.
 *
 * The freshness this gives up has to be bought back deliberately, and that debt
 * is ALREADY outstanding — it is not a future obligation of the drag PR. The
 * lodging admin panels edit registry rows that `_build_units` projects into
 * this very payload, so they invalidate through
 * `invalidateLodgingRegistryQueries`. Drag placement's mutations must do the
 * same. Long staleTime plus explicit invalidation — not short staleTime plus
 * hope.
 *
 * EVERY hook here is gated on `year > 0`. `CurrentYearContext` returns the
 * literal 0 until the backend supplies the configured year, and neither
 * weekend page reads the `isYearReady` flag it exposes — so without the guard
 * these fire `?year=0` against routers declaring `ge=2000` and eat a 422 on
 * every cold load. The roster's `sessionCmId !== null` guard did not cover it:
 * on a direct deep link the id is parsed synchronously off the URL, on purpose,
 * so it is non-null on the first render while the year is still 0.
 */

import { useQuery } from '@tanstack/react-query'

import {
  fetchHouseholdMedical,
  fetchWeekendRoster as fetchRoster,
  fetchWeekendSessions as fetchSessions,
  fetchWeekendSummary as fetchSummary,
} from '../services/lodgingApi'
import type {
  HouseholdMedical,
  WeekendRoster,
  WeekendSessionList,
  WeekendSummary,
} from '../types/lodging'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

/** Every family-camp and adult weekend for the year. */
export function useWeekendSessions(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<WeekendSessionList>({
    queryKey: queryKeys.weekendSessions(year),
    enabled: year > 0,
    queryFn: () => fetchSessions(fetchWithAuth, year),
  })
}

/**
 * Every weekend in a year with its counts — the lander's whole data need in
 * one request, instead of one roster call per weekend.
 */
export function useWeekendSummary(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<WeekendSummary>({
    queryKey: queryKeys.weekendSummary(year),
    enabled: year > 0,
    queryFn: () => fetchSummary(fetchWithAuth, year),
  })
}

/** The roster for one weekend. Idle until a session is chosen. */
export function useWeekendRoster(year: number, sessionCmId: number | null) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<WeekendRoster>({
    queryKey: queryKeys.weekendRoster(year, sessionCmId ?? 0),
    enabled: year > 0 && sessionCmId !== null,
    queryFn: () => fetchRoster(fetchWithAuth, year, sessionCmId as number),
  })
}

/**
 * PHI. Deliberately opt-in: `enabled` stays false until the user clicks the
 * reveal, so the narrative is never fetched speculatively and never sits in
 * the query cache for someone who only ever looked at the roster.
 *
 * `lodging.phi` is held by admins and the Bunking Staff role. The roster
 * itself is readable by any authenticated user, so this 403s for most of the
 * people who can see the page it sits on — callers must degrade gracefully
 * rather than treat the error as a page failure.
 */
export function useHouseholdMedical(year: number, householdCmId: number | null, enabled: boolean) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<HouseholdMedical>({
    queryKey: queryKeys.householdMedical(year, householdCmId ?? 0),
    enabled: enabled && householdCmId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: () => fetchHouseholdMedical(fetchWithAuth, year, householdCmId as number),
  })
}
