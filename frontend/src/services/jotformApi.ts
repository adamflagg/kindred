/**
 * The Jotform admin API (kindred#2759). Every endpoint is `bunking.manage`-only,
 * so every call goes through `fetchWithAuth` — a bare fetch would 401.
 */
import type {
  JotformActionOutcome,
  JotformFormRowData,
  JotformFormsList,
  JotformFormWriteBody,
  JotformQueue,
} from '../types/jotform'
import { ApiError, toApiError } from './apiError'
import type { FetchWithAuth } from './lodgingApi'

const BASE = '/api/jotform'

/** A Jotform admin API failure. See `apiError.ts` for why each domain keeps its own subclass. */
export class JotformApiError extends ApiError {}

async function ok(response: Response, fallback: string): Promise<Response> {
  if (!response.ok) throw await toApiError(response, fallback, JotformApiError)
  return response
}

export async function fetchJotformForms(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<JotformFormsList> {
  const response = await ok(
    await fetchWithAuth(`${BASE}/forms?year=${String(year)}`),
    'Failed to load the Jotform forms'
  )
  return (await response.json()) as JotformFormsList
}

export async function saveJotformForm(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number,
  body: JotformFormWriteBody
): Promise<JotformFormRowData> {
  const response = await ok(
    await fetchWithAuth(`${BASE}/forms/${String(sessionCmId)}?year=${String(year)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Failed to save the Jotform form'
  )
  return (await response.json()) as JotformFormRowData
}

export async function fetchJotformQueue(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<JotformQueue> {
  const response = await ok(
    await fetchWithAuth(`${BASE}/queue?year=${String(year)}`),
    'Failed to load the Jotform queue'
  )
  return (await response.json()) as JotformQueue
}

/**
 * One adult weekend's queue, read in `scenario` (`''` = the live board) —
 * the weekend Requests tab (kindred#2828 ruling 2026-09-25).
 */
export async function fetchJotformWeekendQueue(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number,
  scenario: string
): Promise<JotformQueue> {
  const params = new URLSearchParams({ year: String(year), session_cm_id: String(sessionCmId) })
  if (scenario !== '') params.set('scenario', scenario)
  const response = await ok(
    await fetchWithAuth(`${BASE}/queue?${params.toString()}`),
    'Failed to load the Jotform requests'
  )
  return (await response.json()) as JotformQueue
}

/**
 * A staff action on a filing. A 200 names the same filer's other filings the
 * action also moved (kindred#2839 follow-up: one filer, one decision); a 204
 * means it moved only the one clicked.
 */
async function post(
  fetchWithAuth: FetchWithAuth,
  url: string,
  body?: unknown
): Promise<JotformActionOutcome> {
  const response = await ok(
    await fetchWithAuth(url, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    'Failed to update the Jotform submission'
  )
  return response.status === 204
    ? null
    : ((await response.json()) as NonNullable<JotformActionOutcome>)
}

export function linkJotformSubmission(
  fetchWithAuth: FetchWithAuth,
  submissionId: string,
  personCmId: number
) {
  return post(fetchWithAuth, `${BASE}/submissions/${submissionId}/link`, {
    person_cm_id: personCmId,
  })
}

export function ignoreJotformSubmission(fetchWithAuth: FetchWithAuth, submissionId: string) {
  return post(fetchWithAuth, `${BASE}/submissions/${submissionId}/ignore`)
}

export function unlinkJotformSubmission(fetchWithAuth: FetchWithAuth, submissionId: string) {
  return post(fetchWithAuth, `${BASE}/submissions/${submissionId}/unlink`)
}

/** Link a filing to a board write-in, addressed as the board addresses it. */
export function linkJotformWriteIn(
  fetchWithAuth: FetchWithAuth,
  submissionId: string,
  unitId: string,
  occupantName: string
) {
  return post(fetchWithAuth, `${BASE}/submissions/${submissionId}/write-in`, {
    unit_id: unitId,
    occupant_name: occupantName,
  })
}
