/* eslint-disable react-refresh/only-export-components */
/**
 * Board-notes test fixture: a hand-built scope value, for component tests
 * that do not want the real provider's data layer. Fictional data only.
 */
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import {
  NotesEnabledContext,
  SubjectNotesContext,
  type SubjectNotesScopeValue,
} from '../components/notes/subjectNotesContext'
import { indexNotes, NO_LAYERS, subjectKey } from '../components/notes/subjectNoteModel'
import type { NoteSubject, SubjectNoteRow } from '../types/subjectNotes'

export const PERSON: NoteSubject = { kind: 'person', cmId: 1000101, sessionCmId: 1000001 }
export const HOUSEHOLD: NoteSubject = { kind: 'household', cmId: 2000001, sessionCmId: 1000005 }

export function noteRow(subject: NoteSubject, body: string, scenario = ''): SubjectNoteRow {
  return {
    subject_kind: subject.kind,
    subject_cm_id: subject.cmId,
    session_cm_id: subject.sessionCmId,
    scenario,
    body,
    updated_by: 'Test Staff',
    updated: '2026-09-25T12:00:00Z',
  }
}

export function scopeValue(
  rows: SubjectNoteRow[] = [],
  overrides: Partial<SubjectNotesScopeValue> = {}
): SubjectNotesScopeValue {
  const index = indexNotes(rows)
  return {
    scenarioId: '',
    scenarioName: '',
    notesFor: (subject) => index.get(subjectKey(subject)) ?? NO_LAYERS,
    save: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
    editor: null,
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
    ...overrides,
  }
}

export function NotesScopeFixture({
  value,
  children,
}: {
  value: SubjectNotesScopeValue | null
  children: ReactNode
}) {
  return (
    <NotesEnabledContext.Provider value={value !== null}>
      <SubjectNotesContext.Provider value={value}>{children}</SubjectNotesContext.Provider>
    </NotesEnabledContext.Provider>
  )
}
