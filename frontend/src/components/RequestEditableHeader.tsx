import EditableRequestType from './EditableRequestType'
import EditableRequestTarget from './EditableRequestTarget'
import { MUTUAL_BADGE_CLASSES } from '../utils/dispositionColors'
import { computeTypeUpdate, computeTargetUpdate } from './requestEditableHelpers'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export interface RequestEditableHeaderProps {
  request: BunkRequestsResponse
  year: number
  sessionId?: number | undefined
  sessionName?: string | undefined
  personMap?: Map<number, PersonsResponse> | undefined
  onUpdate: (updates: Partial<BunkRequestsResponse>) => void
  onViewCamper?: ((personCmId: number) => void) | undefined
  isCurrent?: boolean | undefined
}

export function RequestEditableHeader({
  request,
  year,
  sessionId,
  sessionName,
  personMap,
  onUpdate,
  onViewCamper,
  isCurrent,
}: RequestEditableHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div onClick={(e) => e.stopPropagation()}>
        <EditableRequestType
          value={request.request_type}
          onChange={(newType) =>
            onUpdate(computeTypeUpdate(newType as BunkRequestsResponse['request_type']))
          }
        />
      </div>
      <span className="text-muted-foreground">→</span>
      <div onClick={(e) => e.stopPropagation()}>
        <EditableRequestTarget
          requestType={request.request_type}
          currentPersonId={request.requestee_id}
          agePreferenceTarget={request.age_preference_target}
          sessionId={sessionId ?? request.session_id}
          year={year}
          requesterCmId={request.requester_id}
          requestedPersonName={request.requested_person_name}
          personMap={personMap}
          sessionName={sessionName}
          onChange={(updates) => onUpdate(computeTargetUpdate(updates))}
          onViewCamper={onViewCamper}
        />
      </div>
      {request.is_reciprocal && <span className={MUTUAL_BADGE_CLASSES}>mutual</span>}
      {isCurrent && (
        <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
          Viewing
        </span>
      )}
    </div>
  )
}

export default RequestEditableHeader
