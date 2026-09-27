/**
 * Board notes types (subject_notes, migration 1500000189).
 *
 * Friendly aliases over the generated FastAPI types -- import these rather
 * than reaching into `api-generated/`, as `types/lodging.ts` does.
 */
import type {
  SubjectNoteOut,
  SubjectNotesResponse,
  SubjectNoteWriteResponse,
} from './api-generated'

export type SubjectNoteRow = SubjectNoteOut
export type SubjectNotesPayload = SubjectNotesResponse
export type SubjectNoteWriteResult = SubjectNoteWriteResponse
export type SubjectKind = SubjectNoteOut['subject_kind']

/**
 * Who a note is about, on which registration. `sessionCmId` is the SUBJECT'S
 * OWN session -- an AG camper keeps the AG session's id even on its main
 * session's board -- never the board's.
 */
export interface NoteSubject {
  kind: SubjectKind
  cmId: number
  sessionCmId: number
}
