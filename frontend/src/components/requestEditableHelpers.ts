import type { BunkRequestsResponse, BunkRequestsStatusOptions } from '../types/pocketbase-types'

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
