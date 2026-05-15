import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { BunkRequestRow } from './BunkRequestRow'
import { AllCamperRequestsModal } from './AllCamperRequestsModal'
import { queryKeys } from '../utils/queryKeys'
import { CURRENT_REQUEST_BADGE_CLASSES } from '../utils/dispositionColors'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

interface CamperRequestSummaryProps {
  requesterCmId: number
  year: number
  currentRequestId: string
  requesterName?: string | undefined
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
  requesterName,
}: CamperRequestSummaryProps) {
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // Staff-review exemption: this fetch intentionally does NOT filter
  // status = "resolved". RequestReviewPanel consumes it to show pending
  // and declined rows for staff approval.
  const {
    data: requests = [],
    isLoading: isLoadingRequests,
    isError: isErrorRequests,
  } = useQuery({
    queryKey: queryKeys.camperRequestSummary(requesterCmId, year),
    queryFn: async () => {
      return pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: `requester_id = ${requesterCmId} && year = ${year} && (merged_into = "" || merged_into = null)`,
        sort: '-is_first_requested,request_type',
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
  const nonAgeRequests = requests.filter((r) => r.request_type !== 'age_preference')
  const agePreferenceRequest = requests.find((r) => r.request_type === 'age_preference')
  const isEmpty =
    !isLoading && !isErrorRequests && nonAgeRequests.length === 0 && !agePreferenceRequest

  // Modal is rendered outside the branched body so that a transient loading
  // state — e.g. when the user updates a request's target from inside the
  // modal, the resulting requestee_id change forces the persons query into a
  // fresh isLoading=true cycle — does not unmount the modal mid-flow.
  const modalNode = (
    <AllCamperRequestsModal
      isOpen={modalOpen}
      onClose={() => setModalOpen(false)}
      requesterCmId={requesterCmId}
      requesterName={requesterName ?? 'this camper'}
      year={year}
      currentRequestId={currentRequestId}
    />
  )

  if (isLoading) {
    return (
      <>
        <div className="flex items-center gap-2 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-muted-foreground">Loading requests...</span>
        </div>
        {modalNode}
      </>
    )
  }

  if (isErrorRequests) {
    return (
      <>
        <div className="text-destructive flex items-center gap-2 py-2 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Failed to load requests
        </div>
        {modalNode}
      </>
    )
  }

  if (isEmpty) {
    return (
      <>
        <div className="text-muted-foreground py-2 text-sm italic">No other requests</div>
        {modalNode}
      </>
    )
  }

  return (
    <div className="space-y-1">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Requests from this camper
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="bg-forest-50 text-forest-600 border-forest-300/40 hover:bg-forest-100 dark:bg-forest-900/30 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition"
          aria-label="Manage this camper's requests"
        >
          Manage this camper's requests
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {nonAgeRequests.map((request) => {
        const targetPerson = request.requestee_id
          ? (personMap.get(request.requestee_id) ?? null)
          : null
        const isCurrent = request.id === currentRequestId
        return (
          <div key={request.id} data-testid={`request-row-${request.id}`}>
            <BunkRequestRow
              request={request}
              targetPerson={targetPerson}
              isCurrent={isCurrent}
              badge={
                isCurrent ? (
                  <span className={CURRENT_REQUEST_BADGE_CLASSES}>Current request</span>
                ) : undefined
              }
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

      {modalNode}
    </div>
  )
}
