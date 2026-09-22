/**
 * useCamperJourney — the ONE feed every journey surface reads (adult camper
 * journey spec §5.3): the camper record, the summer board panel, the tooltip,
 * and the Women's/Men's Weekend sidebar.
 *
 * It owns the reads so no consumer has to: the person's own rows (household
 * id, years_at_camp, age), the household journey (family cabins; parent
 * rows), and the person housing read (adult cabins). It runs the feed ONCE,
 * after both housing reads settle — the old per-consumer shape ran it before
 * housing arrived and again after, blanking the rows in between.
 *
 * Fast-follow B replaces this hook's feed `queryFn` with one server call and
 * changes no consumer.
 */
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import type { PersonsResponse } from '../../types/pocketbase-types'
import { EMPTY_JOURNEY_COUNTS } from '../../utils/journeyCountLabel'
import { queryKeys } from '../../utils/queryKeys'
import { useHouseholdJourney, usePersonHousing } from '../useWeekendRoster'
import { fetchCamperJourney } from './fetchCamperJourney'
import type { HistoricalRecord, JourneyCounts } from './types'

const ADULT_AGE = 18
const NO_ROWS: HistoricalRecord[] = []

type PersonFactsRow = Pick<PersonsResponse, 'year' | 'household_id' | 'years_at_camp' | 'age'>

export interface PersonJourneyFacts {
  householdId: number | null
  summers: number
  isAdult: boolean
}

/**
 * What the feed needs from the person's year-scoped rows. `summers` is the most
 * recent NON-ZERO years_at_camp: CampMinder fills it only in seasons someone is
 * a camper, so an adult's current row reads 0 while their last camper year
 * still holds the count (103 of 105 grown-up campers; spec §5.2).
 */
export function personJourneyFacts(rows: PersonFactsRow[], viewYear: number): PersonJourneyFacts {
  const newestFirst = [...rows].sort((a, b) => b.year - a.year)
  const view = newestFirst.find((r) => r.year <= viewYear) ?? newestFirst[0]
  const summers = newestFirst.find((r) => r.years_at_camp > 0)?.years_at_camp ?? 0
  const householdId = view !== undefined && view.household_id > 0 ? view.household_id : null
  return { householdId, summers, isAdult: (view?.age ?? 0) >= ADULT_AGE }
}

export interface UseCamperJourneyResult {
  rows: HistoricalRecord[]
  counts: JourneyCounts
  isLoading: boolean
  error: Error | null
}

export function useCamperJourney(
  personCmId: number | null,
  viewYear: number
): UseCamperJourneyResult {
  const { isLoading: isAuthLoading } = useAuth()
  const validPerson = personCmId !== null && Number.isFinite(personCmId) && personCmId > 0

  const personQ = useQuery({
    queryKey: queryKeys.personRecords(personCmId ?? 0),
    queryFn: () =>
      pb
        .collection<PersonsResponse>('persons')
        .getFullList({ filter: `cm_id = ${String(personCmId)}`, sort: '-year' }),
    enabled: validPerson,
  })
  const facts = personQ.data ? personJourneyFacts(personQ.data, viewYear) : null

  // ⚠️ Both protected reads wait for auth (frontend/CLAUDE.md: "useAuth().isLoading first").
  const householdQ = useHouseholdJourney(isAuthLoading || facts === null ? null : facts.householdId)
  const housingQ = usePersonHousing(isAuthLoading || !validPerson ? null : personCmId)

  const householdSettled = facts !== null && (facts.householdId === null || !householdQ.isPending)
  const housingSettled = validPerson && !isAuthLoading && !housingQ.isPending

  const feedQ = useQuery({
    queryKey: [
      ...queryKeys.camperJourney(personCmId ?? 0, viewYear),
      householdQ.dataUpdatedAt,
      housingQ.dataUpdatedAt,
    ],
    queryFn: () =>
      fetchCamperJourney(personCmId as number, viewYear, {
        familyHousingYears: householdQ.data?.years ?? [],
        adultHousingWeekends: housingQ.data?.weekends ?? [],
        viewerIsAdult: facts?.isAdult ?? false,
      }),
    enabled: householdSettled && housingSettled,
  })

  const counts: JourneyCounts =
    feedQ.data && facts
      ? {
          summers: facts.summers,
          familyWeekends: feedQ.data.familyWeekends,
          adultWeekends: feedQ.data.adultWeekends,
        }
      : EMPTY_JOURNEY_COUNTS

  return {
    rows: feedQ.data?.rows ?? NO_ROWS,
    counts,
    isLoading: personQ.isLoading || feedQ.isLoading,
    error: personQ.error ?? feedQ.error ?? null,
  }
}
