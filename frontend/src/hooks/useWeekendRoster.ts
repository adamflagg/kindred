/**
 * React Query hooks for the weekend lodging roster.
 *
 * The roster and session list use `userDataOptions` (30s stale, refetch on
 * focus) rather than `syncDataOptions`: staff edit cabin assignments in
 * CampMinder while the page is open, and the 2025 values show edits across
 * many distinct days.
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
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

/** Every family-camp and adult weekend for the year. */
export function useWeekendSessions(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<WeekendSessionList>({
    queryKey: queryKeys.weekendSessions(year),
    ...userDataOptions,
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
    ...userDataOptions,
    queryFn: () => fetchSummary(fetchWithAuth, year),
  })
}

/** The roster for one weekend. Idle until a session is chosen. */
export function useWeekendRoster(year: number, sessionCmId: number | null) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<WeekendRoster>({
    queryKey: queryKeys.weekendRoster(year, sessionCmId ?? 0),
    ...userDataOptions,
    enabled: sessionCmId !== null,
    queryFn: () => fetchRoster(fetchWithAuth, year, sessionCmId as number),
  })
}

/**
 * PHI. Deliberately opt-in: `enabled` stays false until the user clicks the
 * reveal, so the narrative is never fetched speculatively and never sits in
 * the query cache for someone who only ever looked at the roster.
 *
 * `lodging.phi` is currently granted to no role, so in practice this 403s for
 * every non-admin. Callers must degrade gracefully rather than treat the
 * error as a page failure.
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
