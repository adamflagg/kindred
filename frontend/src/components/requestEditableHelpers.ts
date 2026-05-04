import type { BunkRequestsResponse } from '../types/pocketbase-types'

export function computeTypeUpdate(
  newType: BunkRequestsResponse['request_type']
): Partial<BunkRequestsResponse> {
  const updates: Partial<BunkRequestsResponse> = { request_type: newType }
  if (newType === 'age_preference') {
    // PocketBase requires null (not 0) to clear; 0 causes unique constraint violations.
    updates.requestee_id = null as unknown as number
  } else {
    updates.age_preference_target = ''
  }
  // #1028 — switching type invalidates prior resolution; the resolved state is now
  // stale because the target field has been cleared. Reset to pending so staff review.
  updates.status = 'pending'
  updates.confidence_score = 0
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
    pbUpdates.status = 'resolved'
    pbUpdates.confidence_score = 1.0
  } else if (updates.requestee_id !== undefined && !updates.requestee_id) {
    // #997 — clearing requestee_id (null or 0) must demote back to pending
    pbUpdates.status = 'pending'
    pbUpdates.confidence_score = 0
  }
  return pbUpdates
}
