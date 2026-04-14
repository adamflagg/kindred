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
