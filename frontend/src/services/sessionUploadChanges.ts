import type { FetchWithAuth } from './csvPipelineStatus'

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
