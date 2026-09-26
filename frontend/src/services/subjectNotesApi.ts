/**
 * Board notes API client (/api/subject-notes).
 *
 * Every function takes `fetchWithAuth` from `useApiWithAuth()` as its first
 * parameter; services never import it. The endpoints are `bunking.manage`-only
 * for reading as well as writing.
 */
import type {
  NoteSubject,
  SubjectNotesPayload,
  SubjectNoteWriteResult,
} from '../types/subjectNotes'
import { ApiError, toApiError } from './apiError'

const API_BASE = '/api/subject-notes'

export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

export class SubjectNotesApiError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'SubjectNotesApiError'
  }
}

export interface SubjectNoteKeyInput {
  subject: NoteSubject
  year: number
  /** `''` is the standard note; a scenario id is that scenario's plan-only note. */
  scenario: string
}

export interface SubjectNoteWrite extends SubjectNoteKeyInput {
  /** Empty or whitespace-only deletes the note. */
  body: string
}

function keyBody({ subject, year, scenario }: SubjectNoteKeyInput) {
  return {
    subject_kind: subject.kind,
    subject_cm_id: subject.cmId,
    session_cm_id: subject.sessionCmId,
    year,
    scenario,
  }
}

/** The board read: `sessionCmId` is the BOARD's session (its AG children come along server-side). */
export async function fetchSubjectNotes(
  fetchWithAuth: FetchWithAuth,
  { year, sessionCmId, scenario }: { year: number; sessionCmId: number; scenario: string }
): Promise<SubjectNotesPayload> {
  const params = new URLSearchParams({ session_cm_id: String(sessionCmId), year: String(year) })
  if (scenario) params.set('scenario', scenario)
  const response = await fetchWithAuth(`${API_BASE}?${params.toString()}`)
  if (!response.ok) throw await toApiError(response, 'Failed to load notes', SubjectNotesApiError)
  return response.json() as Promise<SubjectNotesPayload>
}

export async function saveSubjectNote(
  fetchWithAuth: FetchWithAuth,
  write: SubjectNoteWrite
): Promise<SubjectNoteWriteResult> {
  const response = await fetchWithAuth(API_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...keyBody(write), body: write.body }),
  })
  if (!response.ok)
    throw await toApiError(response, 'Failed to save the note', SubjectNotesApiError)
  return response.json() as Promise<SubjectNoteWriteResult>
}

/** "Keep on all plans": append the plan-only note to the standard note (server-side). */
export async function promoteSubjectNote(
  fetchWithAuth: FetchWithAuth,
  key: SubjectNoteKeyInput
): Promise<SubjectNoteWriteResult> {
  const response = await fetchWithAuth(`${API_BASE}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keyBody(key)),
  })
  if (!response.ok)
    throw await toApiError(response, 'Failed to keep the note on all plans', SubjectNotesApiError)
  return response.json() as Promise<SubjectNoteWriteResult>
}
