/**
 * useCamperJourney — the ONE feed every journey surface reads: the camper
 * record, the summer board panel, and the Women's/Men's Weekend sidebar.
 *
 * One server call since kindred#2776 (`GET /api/campers/{id}/journey?year=`):
 * the person's facts at the viewed year (household, adulthood, summers), the
 * household journey, the person-housing read and the merge all run on the
 * server. The four client queries this hook used to chain — and the cache
 * key that had to carry adulthood, household and both housing reads'
 * `dataUpdatedAt` to stay honest — are gone. No consumer changed.
 *
 * Inherits the app's cache defaults (`utils/queryClient.ts`), like the
 * board's primary read path. Freshness after a registry edit comes from
 * `invalidateLodgingRegistryQueries`, which invalidates this key by prefix.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { EMPTY_JOURNEY_COUNTS } from '../../utils/journeyCountLabel'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { fetchCamperJourney } from './fetchCamperJourney'
import { cabinsByWeekend, type CabinLabel } from './teenCabinLabel'
import type { HistoricalRecord, JourneyCounts } from './types'

const NO_ROWS: HistoricalRecord[] = []
const NO_TEEN_CABINS: Map<string, CabinLabel> = new Map()

export interface UseCamperJourneyResult {
  rows: HistoricalRecord[]
  counts: JourneyCounts
  isLoading: boolean
  error: Error | null
  /**
   * The registry-resolved TLI/SCIT cabins, keyed `${year}:${sessionCmId}`
   * (Q9, owner ruling 2026-09-22 late). Exposed so a CURRENT-year row —
   * built outside this feed, from live attendees — can apply the same
   * "registry-resolved cabin, or nothing" rule the server applies to prior
   * years.
   */
  teenCabinsByWeekend: Map<string, CabinLabel>
}

export function useCamperJourney(
  personCmId: number | null,
  viewYear: number
): UseCamperJourneyResult {
  const { isLoading: isAuthLoading } = useAuth()
  const { fetchWithAuth } = useApiWithAuth()
  const validPerson = personCmId !== null && Number.isFinite(personCmId) && personCmId > 0

  // ⚠️ Protected: waits for auth (frontend/CLAUDE.md: "useAuth().isLoading
  // first") — `fetchWithAuth` reads the token at call time, so a read sent
  // mid-restore would carry no Authorization header. No `placeholderData`:
  // the key changes only with the person or the year, and another person's
  // or year's journey must never stand in for this one.
  const journeyQ = useQuery({
    queryKey: queryKeys.camperJourney(personCmId ?? 0, viewYear),
    queryFn: () => fetchCamperJourney(fetchWithAuth, personCmId as number, viewYear),
    enabled: !isAuthLoading && validPerson,
  })

  const teenCabins = journeyQ.data?.teenCabins
  const teenCabinsByWeekend = useMemo(
    () => (teenCabins ? cabinsByWeekend(teenCabins) : NO_TEEN_CABINS),
    [teenCabins]
  )

  const error = journeyQ.error ?? null
  return {
    rows: journeyQ.data?.rows ?? NO_ROWS,
    counts: journeyQ.data?.counts ?? EMPTY_JOURNEY_COUNTS,
    // A disabled query (waiting on auth) is pending too, and that wait is
    // loading — callers render a loader rather than an empty journey.
    isLoading: validPerson && error === null && journeyQ.isPending,
    error,
    teenCabinsByWeekend,
  }
}
