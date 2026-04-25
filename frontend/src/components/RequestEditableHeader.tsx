import EditableRequestType from './EditableRequestType'
import EditableRequestTarget from './EditableRequestTarget'
import { MUTUAL_BADGE_CLASSES } from '../utils/dispositionColors'
import type {
  BunkRequestsResponse,
  BunkRequestsStatusOptions,
  PersonsResponse,
} from '../types/pocketbase-types'

export function computeTypeUpdate(
  newType: BunkRequestsResponse['request_type']
): Partial<BunkRequestsResponse> {
  const updates: Partial<BunkRequestsResponse> = { request_type: newType }
  if (newType === 'age_preference') {
    updates.requestee_id = null as unknown as number
  } else {
    updates.age_preference_target = ''
  }
  return updates
}

export function computeTargetUpdate(updates: {
  requestee_id?: number | null
  age_preference_target?: string
}): Partial<BunkRequestsResponse> {
  const pbUpdates: Partial<BunkRequestsResponse> = {}
  if (updates.requestee_id !== undefined) {
    pbUpdates.requestee_id = updates.requestee_id as unknown as number
  }
  if (updates.age_preference_target !== undefined) {
    pbUpdates.age_preference_target = updates.age_preference_target
  }
  if (updates.requestee_id && updates.requestee_id > 0) {
    pbUpdates.status = 'resolved' as BunkRequestsStatusOptions
    pbUpdates.confidence_score = 1.0
  }
  return pbUpdates
}

export interface RequestEditableHeaderProps {
  request: BunkRequestsResponse
  year: number
  sessionId?: number
  sessionName?: string
  personMap?: Map<number, PersonsResponse>
  onUpdate: (updates: Partial<BunkRequestsResponse>) => void
  onViewCamper?: (personCmId: number) => void
  isCurrent?: boolean
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
  const disabled = request.request_locked
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div onClick={(e) => e.stopPropagation()}>
        <EditableRequestType
          value={request.request_type}
          onChange={(newType) =>
            onUpdate(computeTypeUpdate(newType as BunkRequestsResponse['request_type']))
          }
          disabled={disabled}
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
          {...(personMap ? { personMap } : {})}
          {...(sessionName ? { sessionName } : {})}
          disabled={disabled}
          onChange={(updates) => onUpdate(computeTargetUpdate(updates))}
          {...(onViewCamper ? { onViewCamper } : {})}
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
