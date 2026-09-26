/**
 * Board notes -- one provider per board (weekend: WeekendRosterPage around
 * LodgingBoard; summer: SessionView around BunkingBoardByArea).
 *
 * ALWAYS renders both providers, whatever `canManage` is: swapping the tree's
 * root element when the permission resolves would remount the whole board.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  usePromoteSubjectNote,
  useSaveSubjectNote,
  useSubjectNotes,
} from '../../hooks/useSubjectNotes'
import type { NoteSubject } from '../../types/subjectNotes'
import {
  NotesEnabledContext,
  SubjectNotesContext,
  type EditorRequest,
  type EditorTarget,
  type SubjectNotesScopeValue,
} from './subjectNotesContext'
import { indexNotes, NO_LAYERS, subjectKey, type NoteDrafts } from './subjectNoteModel'

export interface SubjectNotesScopeProps {
  year: number
  /** The BOARD's session (summer main; a weekend is itself). */
  sessionCmId: number
  /** Already scoped to this board (`scenarioForWeekend`); `''` is CampMinder live. */
  scenarioId: string
  scenarioName: string
  /** `bunking.manage`. Without it there is no read, no corner and no section. */
  canManage: boolean
  children: ReactNode
}

export function SubjectNotesScope({
  year,
  sessionCmId,
  scenarioId,
  scenarioName,
  canManage,
  children,
}: SubjectNotesScopeProps) {
  const notesQuery = useSubjectNotes({
    year,
    sessionCmId,
    scenario: scenarioId,
    enabled: canManage,
  })
  const { mutateAsync: saveNote } = useSaveSubjectNote()
  const { mutateAsync: promoteNote } = usePromoteSubjectNote()
  const [editor, setEditor] = useState<EditorTarget | null>(null)

  // A different board or plan: nothing open survives it. A panel editor
  // flushes on unmount into the scenario it was OPENED in (EditorTarget).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: closes any open editor when the board's session or scenario changes (R15); there is no prop to derive this from during render.
    setEditor(null)
  }, [sessionCmId, scenarioId])

  const index = useMemo(() => indexNotes(notesQuery.data?.notes ?? []), [notesQuery.data])
  const notesFor = useCallback(
    (subject: NoteSubject) => index.get(subjectKey(subject)) ?? NO_LAYERS,
    [index]
  )

  const save = useCallback(
    async (subject: NoteSubject, drafts: NoteDrafts, inScenario: string) => {
      if (drafts.standard !== undefined) {
        await saveNote({ subject, year, scenario: '', body: drafts.standard })
      }
      // The live view has no plan layer to write.
      if (drafts.plan !== undefined && inScenario !== '') {
        await saveNote({ subject, year, scenario: inScenario, body: drafts.plan })
      }
    },
    [saveNote, year]
  )

  const promote = useCallback(
    async (subject: NoteSubject, drafts: NoteDrafts, inScenario: string) => {
      // Ruling R4: flush what is typed, then let the server append.
      await save(subject, drafts, inScenario)
      await promoteNote({ subject, year, scenario: inScenario })
    },
    [save, promoteNote, year]
  )

  const openEditor = useCallback(
    (request: EditorRequest) => {
      setEditor({ ...request, scenarioId })
    },
    [scenarioId]
  )
  const closeEditor = useCallback((target?: EditorTarget) => {
    setEditor((current) => (target === undefined || current === target ? null : current))
  }, [])

  const value = useMemo<SubjectNotesScopeValue>(
    () => ({ scenarioId, scenarioName, notesFor, save, promote, editor, openEditor, closeEditor }),
    [scenarioId, scenarioName, notesFor, save, promote, editor, openEditor, closeEditor]
  )

  return (
    <NotesEnabledContext.Provider value={canManage}>
      <SubjectNotesContext.Provider value={canManage ? value : null}>
        {children}
      </SubjectNotesContext.Provider>
    </NotesEnabledContext.Provider>
  )
}
