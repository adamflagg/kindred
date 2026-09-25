/**
 * The Jotform admin API (kindred#2759). Every endpoint is `bunking.manage`-only,
 * so every call goes through `fetchWithAuth` — a bare fetch would 401.
 */
import type {
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

async function post(fetchWithAuth: FetchWithAuth, url: string, body?: unknown): Promise<void> {
  await ok(
    await fetchWithAuth(url, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    'Failed to update the Jotform submission'
  )
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
