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
 * hazard being bought. What it cost was real: `build_roster` issues ten
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
  fetchHouseholdJourney,
  fetchHouseholdMedical,
  fetchWeekendRoster as fetchRoster,
  fetchWeekendSessions as fetchSessions,
  fetchWeekendSummary as fetchSummary,
} from '../services/lodgingApi'
import { childSurnames, familyNameLabel } from '../components/weekend/householdIdentity'
import type {
  HouseholdJourney,
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

/**
 * The roster for one weekend, in one scenario. Idle until a session is chosen.
 *
 * `scenario` is the empty string for the CampMinder mirror and a
 * `saved_scenarios` id for a draft, and it is part of the QUERY KEY, not just
 * the request. A scenario replaces the mirror rather than overlaying it
 * (kindred#1974), so the two are different documents; keyed alike, selecting a
 * draft would resolve out of the mirror's cached entry and — at the app
 * default 30 minute staleTime — never refetch behind it.
 */
export function useWeekendRoster(year: number, sessionCmId: number | null, scenario: string) {
  const { fetchWithAuth } = useApiWithAuth()
  // NOTE for the board's merge/split morph (`BoardMorphBoundary`): since the
  // click-time view overlay (kindred#2537), the ANIMATING commit is driven
  // by LodgingBoard's own setState at the gesture, not by this query — the
  // hard dependency on synchronous commits lives on `overrideDrawLevel`.
  // This query is the morph's FALLBACK path (a hinted swap arriving with no
  // overlay) and confirms/prunes the overlay; wrapping it in startTransition
  // or useDeferredValue would delay that reconciliation, not break the morph.
  return useQuery<WeekendRoster>({
    queryKey: queryKeys.weekendRoster(year, sessionCmId ?? 0, scenario),
    enabled: year > 0 && sessionCmId !== null,
    queryFn: () => fetchRoster(fetchWithAuth, year, sessionCmId as number, scenario),
  })
}

/**
 * A household's year-over-year family-camp record (kindred#2073). Idle until
 * there is a household to look up — an adult weekend guest is person-grain
 * and has none.
 *
 * Sets NO cache options, inheriting the app defaults in `utils/queryClient.ts`
 * exactly as the roster hooks above do and as summer's own board hooks do.
 * Nothing in this repo writes a past year's `cabin_assignment` or
 * `family_camp_adults` — both are sync-written — so there is no writer to
 * invalidate against on the history itself.
 *
 * ⚠ kindred#2332 CHANGED THE SECOND HALF OF THAT ARGUMENT. `cabin_name` is now
 * the unit's present-day `lodging_units.name`, resolved server-side, so an
 * admin-panel rename DOES move this payload — and admin renames are written
 * straight to PocketBase, not through this API. `invalidateLodgingRegistryQueries`
 * is what covers it; a rename that leaves this key alone shows the old name in
 * the history modal while the board behind it shows the new one, which is the
 * exact disagreement this issue existed to remove.
 *
 * NOT year-scoped, unlike every other hook here. See `queryKeys.householdJourney`.
 */
export function useHouseholdJourney(householdCmId: number | null) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<HouseholdJourney>({
    queryKey: queryKeys.householdJourney(householdCmId ?? 0),
    enabled: householdCmId !== null && householdCmId > 0,
    queryFn: () => fetchHouseholdJourney(fetchWithAuth, householdCmId as number),
  })
}

/**
 * A household's family name for a caller with NO roster context — the
 * cabin-weekend attribution admin tab (kindred#2650 owner finding: a raw
 * household id "is not helpful, needs to show the family name"). `FamilyCard`
 * and `FamilyDetailsPanel` derive the same label from `party.children` off an
 * already-loaded roster; this surface has no roster at all, so it fetches the
 * one household's OWN journey (this file's `useHouseholdJourney`, already
 * used for kindred#2073's card) and reduces it through the exact same
 * `familyNameLabel(childSurnames(…))` pair `HouseholdJourneyCard` uses for
 * its own cross-year heading — ONE naming derivation (kindred#2180), two data
 * sources, never a second implementation of the rule.
 *
 * `undefined` while loading, on error, or when the union of every year's
 * children carries no surname (a first-time household with no attendee row
 * yet) — callers fall back to the raw id, matching
 * `SessionAttributionRow`'s existing fallback contract.
 */
export function useHouseholdFamilyLabel(householdCmId: number): string | undefined {
  const { data } = useHouseholdJourney(householdCmId > 0 ? householdCmId : null)
  const years = data?.years ?? []
  const label = familyNameLabel(years.flatMap((row) => childSurnames(row.children)))
  return label.length > 0 ? label : undefined
}

/**
 * The medical narrative. Deliberately opt-in: `enabled` is false unless the
 * caller both holds `bunking.manage` and has a household to look up, so it is
 * never fetched speculatively and never sits in the query cache for someone
 * who only ever looked at the roster.
 *
 * The click-to-reveal that used to supply `enabled` is gone (kindred#1889).
 * Two callers supply it themselves now, at two different grains, and each is
 * proportionate to what is actually on screen: `HousingNeedDetails`, which
 * `FamilyDetailsPanel` renders for ONE household at a time, so fetching on
 * MOUNT is fine; and `NeedGlyph`, the board's glyph tooltip, which mounts its
 * own fetch component only while the bubble is OPEN, so ~82 cards on a page
 * fetch nothing until a staff member actually asks one. `staleTime: 0,
 * gcTime: 0` is what keeps both honest: the narrative leaves the cache the
 * moment the panel closes or the bubble unmounts.
 *
 * `bunking.manage` is held by admins and the Bunking Staff role (kindred#2312
 * retargeted the gate from the now-removed `lodging.phi`, which gated only
 * this one endpoint — there is one permission on this surface, not two). The
 * roster itself is readable by any authenticated user, so this 403s for most
 * of the people who can see the page it sits on — callers must degrade
 * gracefully rather than treat the error as a page failure.
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
