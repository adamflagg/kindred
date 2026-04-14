import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { BunkRequestRow } from './BunkRequestRow'
import { queryKeys } from '../utils/queryKeys'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

interface CamperRequestSummaryProps {
  requesterCmId: number
  year: number
  currentRequestId: string
}

/**
 * Renders the full set of bunk requests submitted by a given requester
 * (other than age_preference rows), used in the expanded request row so
 * reviewers can see all asks from a single camper at a glance. The
 * `currentRequestId` row gets a "you are here" ring highlight.
 */
export function CamperRequestSummary({
  requesterCmId,
  year,
  currentRequestId,
}: CamperRequestSummaryProps) {
  const { user } = useAuth()

  const {
    data: requests = [],
    isLoading: isLoadingRequests,
    isError: isErrorRequests,
  } = useQuery({
    queryKey: queryKeys.camperRequestSummary(requesterCmId, year),
    queryFn: async () => {
      return pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: `requester_id = ${requesterCmId} && year = ${year} && (merged_into = "" || merged_into = null)`,
        sort: '-priority,request_type',
      })
    },
    staleTime: 30000,
    enabled: !!user && requesterCmId > 0,
  })

  const requesteeIds = useMemo(() => {
    const ids = new Set<number>()
    requests.forEach((r) => {
      if (r.requestee_id && r.requestee_id > 0) {
        ids.add(r.requestee_id)
      }
    })
    return Array.from(ids).sort((a, b) => a - b)
  }, [requests])

  const { data: persons = [], isLoading: isLoadingPersons } = useQuery({
    queryKey: queryKeys.camperRequestSummaryPersons(requesteeIds, year),
    queryFn: async () => {
      if (requesteeIds.length === 0) return []
      const chunks: number[][] = []
      for (let i = 0; i < requesteeIds.length; i += 50) {
        chunks.push(requesteeIds.slice(i, i + 50))
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          pb.collection<PersonsResponse>('persons').getFullList({
            filter: `(${chunk.map((id) => `cm_id = ${id}`).join(' || ')}) && year = ${year}`,
          })
        )
      )
      return results.flat()
    },
    enabled: !!user && requesteeIds.length > 0,
    staleTime: 30000,
  })

  const personMap = useMemo(() => new Map(persons.map((p) => [p.cm_id, p])), [persons])

  const isLoading = isLoadingRequests || isLoadingPersons

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-muted-foreground">Loading requests...</span>
      </div>
    )
  }

  if (isErrorRequests) {
    return (
      <div className="text-destructive flex items-center gap-2 py-2 text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        Failed to load requests
      </div>
    )
  }

  const nonAgeRequests = requests.filter((r) => r.request_type !== 'age_preference')
  const agePreferenceRequest = requests.find((r) => r.request_type === 'age_preference')

  if (nonAgeRequests.length === 0 && !agePreferenceRequest) {
    return <div className="text-muted-foreground py-2 text-sm italic">No other requests</div>
  }

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
        Other requests from this camper
      </div>
      {nonAgeRequests.map((request) => {
        const targetPerson = request.requestee_id
          ? (personMap.get(request.requestee_id) ?? null)
          : null
        return (
          <div key={request.id} data-testid={`request-row-${request.id}`}>
            <BunkRequestRow
              request={request}
              targetPerson={targetPerson}
              isCurrent={request.id === currentRequestId}
            />
          </div>
        )
      })}
      {agePreferenceRequest?.age_preference_target && (
        <div
          className={nonAgeRequests.length > 0 ? 'border-border/50 mt-3 border-t pt-2' : ''}
          data-testid={`request-row-${agePreferenceRequest.id}`}
        >
          <BunkRequestRow request={agePreferenceRequest} />
        </div>
      )}
    </div>
  )
}
