/**
 * Board notes -- the board-level context, split in two so a memo'd card
 * never re-renders for a note change:
 *
 * - `NotesEnabledContext` is a boolean that only moves with the permission.
 *   Board adapters (`useNoteSlots`) read THIS, so a note save or an editor
 *   opening never re-renders the board.
 * - `SubjectNotesContext` carries the notes and the open editor. Only the
 *   corner, the section and the editor read it -- small leaves.
 */
import { createContext, useContext } from 'react'

import type { NoteSubject } from '../../types/subjectNotes'
import type { NoteDrafts, SubjectLayers } from './subjectNoteModel'

export interface EditorRequest {
  subject: NoteSubject
  /** The name in the popover header: "Note · ‹label›". */
  label: string
  surface: 'popover' | 'panel'
  /** The corner that opened a popover; it anchors to that corner's card. */
  anchorEl: HTMLElement | null
  /** Open with the plan-only box expanded and focused. */
  want?: 'plan'
}

export interface EditorTarget extends EditorRequest {
  /** The scenario the editor was OPENED in; a later flush still writes there. */
  scenarioId: string
}

export interface SubjectNotesScopeValue {
  /** `''` is the CampMinder live view. */
  scenarioId: string
  scenarioName: string
  notesFor: (subject: NoteSubject) => SubjectLayers
  save: (subject: NoteSubject, drafts: NoteDrafts, scenarioId: string) => Promise<void>
  promote: (subject: NoteSubject, drafts: NoteDrafts, scenarioId: string) => Promise<void>
  editor: EditorTarget | null
  openEditor: (request: EditorRequest) => void
  /** With a target, closes only if that target is still the open editor. */
  closeEditor: (target?: EditorTarget) => void
}

export const NotesEnabledContext = createContext(false)
export const SubjectNotesContext = createContext<SubjectNotesScopeValue | null>(null)

export function useNotesEnabled(): boolean {
  return useContext(NotesEnabledContext)
}

/** `null` outside a scope, or for a viewer without `bunking.manage`. */
export function useSubjectNotesScope(): SubjectNotesScopeValue | null {
  return useContext(SubjectNotesContext)
}
