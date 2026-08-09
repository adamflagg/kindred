/**
 * Weekend friend-group API client (kindred#1913 half 1).
 *
 * Its own module rather than more functions in `lodgingApi.ts`, matching the
 * split on the server: `/api/lodging/friend-groups` is a separate router over
 * a separate service, because a group is an INPUT to placement rather than a
 * placement.
 *
 * Every function takes `fetchWithAuth` as its first parameter — obtained by
 * the caller from `useApiWithAuth()`. Services never import it. The PocketBase
 * JWT lives in localStorage, so a raw fetch with `credentials: 'include'`
 * silently 401s (frontend/CLAUDE.md).
 */

import type {
  FriendGroupCreate,
  FriendGroupList,
  FriendGroupRow,
  FriendGroupUpdate,
} from '../types/friendGroups'
import { ApiError, toApiError } from './apiError'

const API_BASE = '/api/lodging/friend-groups'

/** The wrapper returned by `useApiWithAuth().fetchWithAuth`. */
export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

/** An API failure that still knows its HTTP status — see `apiError.ts`. */
export class FriendGroupApiError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'FriendGroupApiError'
  }
}

async function toError(response: Response, fallback: string): Promise<FriendGroupApiError> {
  return toApiError(response, fallback, FriendGroupApiError)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Every friend group on one weekend, with its household membership. */
export async function fetchFriendGroups(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number
): Promise<FriendGroupList> {
  const query = `year=${String(year)}&session_cm_id=${String(sessionCmId)}`
  const response = await fetchWithAuth(`${API_BASE}?${query}`)
  if (!response.ok) throw await toError(response, 'Failed to load friend groups')
  return response.json() as Promise<FriendGroupList>
}

/** Author one group over at least two households. */
export async function createFriendGroup(
  fetchWithAuth: FetchWithAuth,
  body: FriendGroupCreate
): Promise<FriendGroupRow> {
  const response = await fetchWithAuth(API_BASE, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await toError(response, 'Failed to create the friend group')
  return response.json() as Promise<FriendGroupRow>
}

/**
 * Rename, recolour, or replace the membership.
 *
 * A true PATCH: send ONLY what changed. Sending the whole group back would
 * turn a recolour into a rewrite of the name and membership too, which is the
 * behaviour the server's `exclude_unset` exists to make impossible from here.
 */
export async function updateFriendGroup(
  fetchWithAuth: FetchWithAuth,
  groupId: string,
  body: FriendGroupUpdate
): Promise<FriendGroupRow> {
  const response = await fetchWithAuth(`${API_BASE}/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await toError(response, 'Failed to update the friend group')
  return response.json() as Promise<FriendGroupRow>
}

/** Dissolve a group. Its membership cascades away server-side (1500000146). */
export async function deleteFriendGroup(
  fetchWithAuth: FetchWithAuth,
  groupId: string
): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw await toError(response, 'Failed to dissolve the friend group')
}
