import type { BunkRequestsResponse } from '../types/pocketbase-types'

/**
 * Returns true when a bunk request has been resolved and has a confirmed
 * requestee — i.e., the requested camper is in the same bunk.
 */
export function isConfirmedRequest(request: {
  status: string
  requestee_id?: number | null
}): boolean {
  return Boolean(request.status === 'resolved' && request.requestee_id && request.requestee_id > 0)
}

/**
 * Returns true when a bunk request points at a known camper — i.e., it has a
 * real positive `requestee_id` AND a non-empty resolvable name. This is true
 * for resolved rows AND for declined-but-matched rows (e.g. cross-session
 * declines where the target camper exists but can't be placed together).
 *
 * Shared guard used by both BunkRequestRow and AllCamperRequestsModal — keep
 * them in sync so clickable-link vs italic-unresolved semantics match across
 * both surfaces.
 */
export function hasMatchedRequestTarget(
  request: Pick<BunkRequestsResponse, 'requestee_id'>,
  targetName?: string | null
): targetName is string {
  return Boolean(
    request.requestee_id &&
    request.requestee_id > 0 &&
    typeof targetName === 'string' &&
    targetName.length > 0
  )
}
