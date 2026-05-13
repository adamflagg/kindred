import { memo, useCallback } from 'react'
import clsx from 'clsx'
import { CheckCircle, CheckCheck, XCircle, Scissors } from 'lucide-react'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'
import EditableRequestType from './EditableRequestType'
import EditableRequestTarget from './EditableRequestTarget'
import { computeTypeUpdate, computeTargetUpdate } from './requestEditableHelpers'
import {
  formatReason,
  shouldShowReasonInStatus,
  CONFIDENCE_AUTO_ACCEPT,
  CONFIDENCE_RESOLVED,
  MUTUAL_BADGE_CLASSES,
} from '../utils/dispositionColors'
import { formatGradeOrdinal } from '../utils/gradeUtils'

export interface RequestRowMobileProps {
  request: BunkRequestsResponse
  requester: PersonsResponse | undefined
  requestee: PersonsResponse | undefined
  isSelected: boolean
  sessionId: number
  year: number
  sessionName?: string | undefined
  personMap: Map<number, PersonsResponse>
  hasMultipleSources: boolean
  onToggleSelection: (id: string) => void
  onSelectCamper: (cmId: string) => void
  onValidatedUpdate: (request: BunkRequestsResponse, updates: Partial<BunkRequestsResponse>) => void
  onSplit: (request: BunkRequestsResponse) => void
  onConfirmAction: (
    e: React.MouseEvent<HTMLButtonElement>,
    action: 'approve' | 'decline',
    id: string
  ) => void
}

function getConfidenceColor(score: number) {
  if (score >= CONFIDENCE_AUTO_ACCEPT)
    return 'text-forest-700 bg-forest-50 dark:text-forest-300 dark:bg-forest-900/30'
  if (score >= CONFIDENCE_RESOLVED)
    return 'text-forest-600 bg-forest-50/70 dark:text-forest-400 dark:bg-forest-900/20'
  if (score >= 0.5) return 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30'
  return 'text-bark-700 bg-bark-50 dark:text-bark-300 dark:bg-bark-900/30'
}

function getConfidenceIndicator(score: number) {
  if (score >= CONFIDENCE_AUTO_ACCEPT) return <CheckCheck className="mr-1 inline h-3 w-3" />
  if (score >= CONFIDENCE_RESOLVED) return <CheckCircle className="mr-1 inline h-3 w-3" />
  return null
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return (
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Pending
        </span>
      )
    case 'resolved':
      return (
        <span className="bg-forest-100 text-forest-800 dark:bg-forest-900/40 dark:text-forest-200 rounded-full px-2.5 py-1 text-xs font-medium">
          Resolved
        </span>
      )
    case 'declined':
      return (
        <span className="bg-bark-100 text-bark-800 dark:bg-bark-900/40 dark:text-bark-200 rounded-full px-2.5 py-1 text-xs font-medium">
          Declined
        </span>
      )
    default:
      return (
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
          {status}
        </span>
      )
  }
}

function RequestRowMobile({
  request,
  requester,
  requestee,
  isSelected,
  sessionId,
  year,
  sessionName,
  personMap,
  hasMultipleSources,
  onToggleSelection,
  onSelectCamper,
  onValidatedUpdate,
  onSplit,
  onConfirmAction,
}: RequestRowMobileProps) {
  const handleToggleSelection = useCallback(() => {
    onToggleSelection(request.id)
  }, [onToggleSelection, request.id])

  const handleSelectRequester = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelectCamper(String(request.requester_id))
    },
    [onSelectCamper, request.requester_id]
  )

  const handleTypeChange = useCallback(
    (newType: string) => {
      onValidatedUpdate(request, computeTypeUpdate(newType as BunkRequestsResponse['request_type']))
    },
    [onValidatedUpdate, request]
  )

  const handleTargetChange = useCallback(
    (updates: Parameters<typeof computeTargetUpdate>[0]) => {
      onValidatedUpdate(request, computeTargetUpdate(updates))
    },
    [onValidatedUpdate, request]
  )

  const handleViewCamper = useCallback(
    (personCmId: number) => {
      onSelectCamper(String(personCmId))
    },
    [onSelectCamper]
  )

  const handleSplit = useCallback(() => {
    onSplit(request)
  }, [onSplit, request])

  const handleApprove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onConfirmAction(e, 'approve', request.id)
    },
    [onConfirmAction, request.id]
  )

  const handleDecline = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onConfirmAction(e, 'decline', request.id)
    },
    [onConfirmAction, request.id]
  )

  return (
    <div
      className="request-card-mobile hover:bg-muted/50 cursor-pointer transition-colors"
      data-testid="request-card-mobile"
    >
      <div className="card-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggleSelection}
          className="h-5 w-5 rounded"
        />
      </div>

      <div className="card-main">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={handleSelectRequester}
            className="hover:text-primary min-w-0 text-left font-medium transition-colors hover:underline"
          >
            {requester
              ? `${requester.first_name || ''} ${requester.last_name || ''}`
              : `Person ${request.requester_id}`}
            {requester?.grade != null && requester.grade > 0 && (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                ({formatGradeOrdinal(requester.grade)})
              </span>
            )}
          </button>
          {request.is_reciprocal && <span className={MUTUAL_BADGE_CLASSES}>mutual</span>}
        </div>
        <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
          <EditableRequestType value={request.request_type} onChange={handleTypeChange} />
        </div>
      </div>

      <div className="card-badges">
        <span
          className={clsx(
            'flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            getConfidenceColor(request.confidence_score)
          )}
        >
          {getConfidenceIndicator(request.confidence_score)}
          {(request.confidence_score * 100).toFixed(0)}%
        </span>
        <div className="flex flex-col items-end gap-0.5">
          {getStatusBadge(request.status)}
          {shouldShowReasonInStatus(request.status, request.disposition_reason) && (
            <span
              data-testid="status-reason-line"
              className="text-muted-foreground max-w-[8rem] truncate text-right text-[11px]"
            >
              {formatReason(request.disposition_reason)}
            </span>
          )}
        </div>
      </div>

      <div className="card-request" onClick={(e) => e.stopPropagation()}>
        <EditableRequestTarget
          requestType={request.request_type}
          currentPersonId={request.requestee_id}
          agePreferenceTarget={request.age_preference_target}
          sessionId={sessionId}
          year={year}
          requesterCmId={request.requester_id}
          onChange={handleTargetChange}
          originalText={request.original_text}
          requestedPersonName={request.requested_person_name}
          parseNotes={request.parse_notes}
          onViewCamper={handleViewCamper}
          personMap={personMap}
          sessionName={sessionName}
        />
        {requestee?.grade != null && requestee.grade > 0 && (
          <span className="text-muted-foreground ml-1 text-xs">
            ({formatGradeOrdinal(requestee.grade)})
          </span>
        )}
      </div>

      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {hasMultipleSources && (
          <button
            onClick={handleSplit}
            className="touch-manipulation rounded-lg p-2 text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
            title="Split merged request"
          >
            <Scissors className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={handleApprove}
          className="hover:bg-forest-100 dark:hover:bg-forest-900/30 text-forest-600 dark:text-forest-400 touch-manipulation rounded-lg p-2 transition-colors"
          title="Approve"
        >
          <CheckCircle className="h-5 w-5" />
        </button>
        <button
          onClick={handleDecline}
          className="hover:bg-destructive/10 text-destructive touch-manipulation rounded-lg p-2 transition-colors"
          title="Reject"
        >
          <XCircle className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export default memo(RequestRowMobile)
