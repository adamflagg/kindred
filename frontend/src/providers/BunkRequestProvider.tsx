import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { useYear } from '../hooks/useCurrentYear'
import { useScenario } from '../hooks/useScenario'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import type { BunkRequest } from '../types/app-types'
import { BunkRequestContext } from '../contexts/BunkRequestContext'
import {
  type CamperSatisfaction,
  emptyCamperSatisfaction,
  type SatisfactionResponse,
} from '../types/satisfaction'
import { queryKeys } from '../utils/queryKeys'

interface BunkRequestProviderProps {
  sessionCmId: number
  children: ReactNode
}

export function BunkRequestProvider({ sessionCmId, children }: BunkRequestProviderProps) {
  const currentYear = useYear()
  const { user, isLoading: isAuthLoading } = useAuth()
  const { currentScenario } = useScenario()
  const { fetchWithAuth } = useApiWithAuth()
  const scenarioId = currentScenario?.id ?? null

  // Fetch ALL bunk requests for the session (for the modal/per-request rows that
  // still need raw rows: bunk-request grid, expanded row details, etc.).
  const {
    data: allRequests = [],
    isLoading: requestsLoading,
    error: requestsError,
  } = useQuery<BunkRequest[]>({
    queryKey: queryKeys.allBunkRequests(sessionCmId, currentYear),
    queryFn: async () => {
      try {
        const filter = `session_id = ${sessionCmId} && year = ${currentYear} && (merged_into = "" || merged_into = null)`
        return await pb.collection<BunkRequest>('bunk_requests').getFullList({
          filter,
          sort: '-is_first_requested,requester_id',
          requestKey: `bunk-requests-${sessionCmId}-${currentYear}`,
        })
      } catch (err) {
        console.error('Error fetching bunk requests:', err)
        return []
      }
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!user && !isAuthLoading && sessionCmId > 0,
  })

  // Fetch satisfaction state from /api/satisfaction — single source of truth
  // for "is request X satisfied?". Replaces the deleted local predicates.
  const {
    data: satisfaction,
    isLoading: satisfactionLoading,
    error: satisfactionError,
  } = useQuery<SatisfactionResponse>({
    queryKey: queryKeys.satisfaction(sessionCmId, currentYear, scenarioId),
    queryFn: async () => {
      const params = new URLSearchParams({
        session: String(sessionCmId),
        year: String(currentYear),
      })
      if (scenarioId) params.set('scenario', scenarioId)
      const response = await fetchWithAuth(`/api/satisfaction?${params}`)
      if (!response.ok) {
        throw new Error(`/api/satisfaction failed: ${response.status}`)
      }
      return (await response.json()) as SatisfactionResponse
    },
    staleTime: 30 * 1000, // matches social-graph staleness
    gcTime: 10 * 60 * 1000,
    enabled: !!user && !isAuthLoading && sessionCmId > 0,
  })

  // Pre-compute request lookups for hasRequests / getRequestsForCamper
  const requestsByPerson = useMemo(() => {
    const map = new Map<number, BunkRequest[]>()
    allRequests.forEach((request) => {
      const list = map.get(request.requester_id)
      if (list) list.push(request)
      else map.set(request.requester_id, [request])
    })
    return map
  }, [allRequests])

  const hasRequests = useCallback(
    (personCmId: number) => requestsByPerson.has(personCmId),
    [requestsByPerson]
  )
  const getRequestsForCamper = useCallback(
    (personCmId: number) => requestsByPerson.get(personCmId) ?? [],
    [requestsByPerson]
  )
  const getSatisfiedRequestInfo = useCallback(
    (personCmId: number): CamperSatisfaction =>
      satisfaction?.campers[String(personCmId)] ?? emptyCamperSatisfaction(personCmId),
    [satisfaction]
  )

  const value = useMemo(
    () => ({
      allRequests,
      hasRequests,
      getRequestsForCamper,
      getSatisfiedRequestInfo,
      isLoading: requestsLoading || satisfactionLoading,
      error: requestsError ?? satisfactionError,
    }),
    [
      allRequests,
      hasRequests,
      getRequestsForCamper,
      getSatisfiedRequestInfo,
      requestsLoading,
      satisfactionLoading,
      requestsError,
      satisfactionError,
    ]
  )

  return <BunkRequestContext.Provider value={value}>{children}</BunkRequestContext.Provider>
}
