import type { FetchWithAuth, UploadCounts } from './csvPipelineStatus'

export interface UploadChangeRow {
  requester_cm_id: number
  requester_name: string
  target_name: string
  request_type: string
  final_status: string
  session_cm_id: number
}

export async function fetchSessionUploadChanges(
  runId: string,
  sessionCmIds: number[],
  fetchWithAuth: FetchWithAuth
): Promise<UploadChangeRow[]> {
  if (sessionCmIds.length === 0) return []
  const sessionClause = sessionCmIds.map((id) => `session_cm_id = ${id}`).join(' || ')
  const filter = encodeURIComponent(`run_id = '${runId}' && (${sessionClause})`)
  const fields =
    'requester_cm_id,requester_name,target_name,request_type,final_status,session_cm_id'
  // perPage=500 is a deliberate ceiling with no pagination — a session
  // realistically produces ≤~100 new requests; >500 would silently truncate.
  const res = await fetchWithAuth(
    `/api/collections/debug_pipeline_summary/records?filter=${filter}&perPage=500&fields=${fields}`
  )
  if (!res.ok) return []
  const data = (await res.json()) as { items?: UploadChangeRow[] }
  return data.items ?? []
}

// kindred#1713 Part 1: PENDING is what SessionUploadChangesModal's own
// `isReview` flags with the "needs review" badge — mirrored here (rather than
// imported) so this stays a plain data-shape predicate with no UI dependency.
// Keep the two in sync if the modal's definition of "review" ever changes.
function isReviewRow(r: UploadChangeRow): boolean {
  return r.final_status.toUpperCase() === 'PENDING'
}

/**
 * Counts these rows the way the "what's new" chip should: one per
 * `debug_pipeline_summary` row (one final bunk_request), not one per trace.
 * A single trace (one form-field row on one camper — e.g. a note naming three
 * friends) can expand into several of these rows via
 * `disposition.final_bunk_requests`, which is exactly what made the old
 * trace-grain `session_breakdown` count wrong.
 */
export function countsFromUploadChangeRows(rows: UploadChangeRow[]): UploadCounts {
  const needReview = rows.filter(isReviewRow).length
  const total = rows.length
  return { total, autoMatched: total - needReview, needReview }
}
