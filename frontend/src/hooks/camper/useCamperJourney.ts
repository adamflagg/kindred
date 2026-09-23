/**
 * useCamperJourney — the ONE feed every journey surface reads: the camper
 * record, the summer board panel, and the Women's/Men's Weekend sidebar.
 *
 * It owns the reads so no consumer has to: the person's own rows (household
 * id, years_at_camp, age), the household journey (family cabins; parent
 * rows), and the person housing read (adult cabins; TLI/SCIT cabins the
 * registry resolves). It runs the feed ONCE,
 * after both housing reads settle — the old per-consumer shape ran it before
 * housing arrived and again after, blanking the rows in between.
 *
 * Fast-follow B replaces this hook's feed `queryFn` with one server call and
 * changes no consumer.
 */
import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import type { PersonsResponse } from '../../types/pocketbase-types'
import { ADULT_AGE } from '../../utils/age'
import { EMPTY_JOURNEY_COUNTS } from '../../utils/journeyCountLabel'
import { queryKeys } from '../../utils/queryKeys'
import { useHouseholdJourney, usePersonHousing } from '../useWeekendRoster'
import { fetchCamperJourney } from './fetchCamperJourney'
import { cabinsByWeekend, type CabinLabel } from './teenCabinLabel'
import type { HistoricalRecord, JourneyCounts } from './types'

const NO_ROWS: HistoricalRecord[] = []
const NO_TEEN_CABINS: Map<string, CabinLabel> = new Map()

type PersonFactsRow = Pick<PersonsResponse, 'year' | 'household_id' | 'years_at_camp' | 'age'>

export interface PersonJourneyFacts {
  householdId: number | null
  summers: number
  /** CampMinder's own age >= ADULT_AGE (owner ruling 2026-09-22: raised from
   * 18 to 21 — teens 18-20 are still campers in summer and teen programs).
   * Decides `viewerIsAdult`, which gates whether parent family-camp rows are
   * added to the feed. */
  isAdult: boolean
}

/**
 * What the feed needs from the person's year-scoped rows. `summers` is the most
 * recent NON-ZERO years_at_camp: CampMinder fills it only in seasons someone is
 * a camper, so an adult's current row reads 0 while their last camper year
 * still holds the count (103 of 105 grown-up campers). Like the
 * weekend counts, it stops at `viewYear` — a later season never leaks back.
 */
export function personJourneyFacts(rows: PersonFactsRow[], viewYear: number): PersonJourneyFacts {
  const newestFirst = [...rows].sort((a, b) => b.year - a.year)
  // No `?? newestFirst[0]` fallback (CR #5, kindred#2753): when every row
  // postdates viewYear there is no row "closest to viewYear from below" —
  // falling back to the newest row leaked a LATER year's household/adulthood
  // into an earlier view. The correct view here is NO row at all.
  const view = newestFirst.find((r) => r.year <= viewYear)
  const summers =
    newestFirst.find((r) => r.year <= viewYear && r.years_at_camp > 0)?.years_at_camp ?? 0
  const householdId = view !== undefined && view.household_id > 0 ? view.household_id : null
  return { householdId, summers, isAdult: (view?.age ?? 0) >= ADULT_AGE }
}

export interface UseCamperJourneyResult {
  rows: HistoricalRecord[]
  counts: JourneyCounts
  isLoading: boolean
  error: Error | null
  /**
   * The registry-resolved TLI/SCIT cabins, keyed `${year}:${sessionCmId}`
   * (Q9, owner ruling 2026-09-22 late). Exposed so a CURRENT-year row —
   * built outside this hook's own feed, from live attendees — can apply the
   * same "registry-resolved cabin, or nothing" rule this hook already
   * applies to prior years in `fetchCamperJourney`.
   */
  teenCabinsByWeekend: Map<string, CabinLabel>
}

export function useCamperJourney(
  personCmId: number | null,
  viewYear: number
): UseCamperJourneyResult {
  const { isLoading: isAuthLoading } = useAuth()
  const validPerson = personCmId !== null && Number.isFinite(personCmId) && personCmId > 0

  // ⚠️ Gated on auth, like its sibling reads below (frontend/CLAUDE.md:
  // "useAuth().isLoading first") — `persons.listRule` requires auth too (CR
  // #6, kindred#2753), and this was the one protected read in this hook not
  // gated on it.
  const personQ = useQuery({
    queryKey: queryKeys.personRecords(personCmId ?? 0),
    queryFn: () =>
      pb
        .collection<PersonsResponse>('persons')
        .getFullList({ filter: `cm_id = ${String(personCmId)}`, sort: '-year' }),
    enabled: !isAuthLoading && validPerson,
  })
  const facts = personQ.data ? personJourneyFacts(personQ.data, viewYear) : null

  // ⚠️ Both protected reads wait for auth (frontend/CLAUDE.md: "useAuth().isLoading first").
  const householdQ = useHouseholdJourney(isAuthLoading || facts === null ? null : facts.householdId)
  const housingQ = usePersonHousing(isAuthLoading || !validPerson ? null : personCmId)

  // "Settled" means not pending — an ERRORED household or housing read counts.
  // Deliberate graceful degradation (as before this hook): the feed still runs
  // with empty housing and the rows render unlabeled rather than erroring.
  const householdSettled = facts !== null && (facts.householdId === null || !householdQ.isPending)
  const housingSettled = validPerson && !isAuthLoading && !housingQ.isPending

  const feedQ = useQuery({
    queryKey: [
      ...queryKeys.camperJourney(personCmId ?? 0, viewYear),
      householdQ.dataUpdatedAt,
      housingQ.dataUpdatedAt,
      // CR #7 (kindred#2753): a persons refetch that changes isAdult or
      // householdId, with neither housing read also refreshing, must still
      // re-run the feed — otherwise it stays computed for the wrong
      // viewerIsAdult until something else happens to bust this key.
      facts?.isAdult ?? false,
      facts?.householdId ?? null,
    ],
    queryFn: () =>
      fetchCamperJourney(personCmId as number, viewYear, {
        familyHousingYears: householdQ.data?.years ?? [],
        adultHousingWeekends: housingQ.data?.weekends ?? [],
        teenCabins: housingQ.data?.teen_cabins ?? [],
        viewerIsAdult: facts?.isAdult ?? false,
      }),
    enabled: householdSettled && housingSettled,
    // The key carries both housing reads' dataUpdatedAt, so ANY housing refetch
    // (e.g. a lodging admin write) re-runs the feed under a new key. Hold the
    // previous rows meanwhile — blanking them is the symptom this hook removes. Only
    // for the SAME person and year: another camper's journey must never stand
    // in for this one's (key layout: ['camper-journey', personCmId, year, …]).
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === personCmId && previousQuery.queryKey[2] === viewYear
        ? keepPreviousData(previous)
        : undefined,
  })

  const counts: JourneyCounts =
    feedQ.data && facts
      ? {
          summers: facts.summers,
          familyWeekends: feedQ.data.familyWeekends,
          adultWeekends: feedQ.data.adultWeekends,
        }
      : EMPTY_JOURNEY_COUNTS

  // Q9 (owner, 2026-09-22 late): the same registry-resolved rows the feed
  // reads for prior years, keyed for a CURRENT-year row to look itself up by.
  const teenCabinsByWeekend = useMemo(
    () =>
      housingQ.data?.teen_cabins ? cabinsByWeekend(housingQ.data.teen_cabins) : NO_TEEN_CABINS,
    [housingQ.data?.teen_cabins]
  )

  const error = personQ.error ?? feedQ.error ?? null
  return {
    rows: feedQ.data?.rows ?? NO_ROWS,
    counts,
    // Not v5's isLoading (isPending && isFetching): the feed is disabled — so
    // not fetching — while it waits for housing, and that wait is loading too.
    isLoading: validPerson && error === null && (personQ.isPending || feedQ.isPending),
    error,
    teenCabinsByWeekend,
  }
}
