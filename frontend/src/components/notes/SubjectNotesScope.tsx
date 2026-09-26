/**
 * Board notes -- one provider per board (weekend: WeekendRosterPage around
 * LodgingBoard; summer: SessionView around BunkingBoardByArea).
 *
 * ALWAYS renders both providers, whatever `canManage` is: swapping the tree's
 * root element when the permission resolves would remount the whole board.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'

import {
  errorText,
  usePromoteSubjectNote,
  useSaveSubjectNote,
  useSubjectNotes,
} from '../../hooks/useSubjectNotes'
import type { NoteSubject } from '../../types/subjectNotes'
import { SubjectNotePopover } from './SubjectNotePopover'
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

  // A different board or plan: nothing open survives it. Adjusted during
  // RENDER (React's "you changed a prop, reset derived state" pattern --
  // `ProcessRequestOptions`'s modal-reset is the other example in this
  // codebase), not an effect: an effect fires a whole commit late, leaving
  // the editor stamped to the OLD board for that one commit -- see the
  // baseline-freeze comment on useSubjectNoteEditor.ts's `scenarioMatches`
  // for the hazard that lag causes downstream. A panel editor flushes on
  // unmount into the scenario it was OPENED in (EditorTarget).
  const boardKey = `${String(sessionCmId)}|${scenarioId}`
  const [prevBoardKey, setPrevBoardKey] = useState(boardKey)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  if (boardKey !== prevBoardKey) {
    setPrevBoardKey(boardKey)
    setEditor(null)
  }

  // A hard read failure is silent otherwise -- toast once per error so
  // staff learn the board couldn't be read, rather than reading a card's
  // missing corner as "no notes". A fixed `id`: this effect has no cleanup,
  // so StrictMode's dev double-invoke would otherwise fire it twice on
  // mount -- react-hot-toast treats a second call with the same `id` as an
  // update to the existing toast, not a second one.
  useEffect(() => {
    if (!notesQuery.isError) return
    toast.error(errorText(notesQuery.error, 'Failed to load notes'), {
      id: 'subject-notes-read',
    })
  }, [notesQuery.isError, notesQuery.error])

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
      // Flush what is typed, then let the server append.
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

  // `notesFor` above falls back to NO_LAYERS whenever `data` is undefined
  // (pending, retrying, or errored) -- exposing the scope in that state
  // would let every card's corner, its "+ Note" menu items and the panel
  // section all read as "no notes yet", and a save from there would upsert
  // OVER a standard note staff simply hadn't been shown yet. Only the VALUE
  // below is gated; both providers still always render so the board never
  // remounts when the read settles.
  const ready = canManage && notesQuery.data !== undefined

  return (
    <NotesEnabledContext.Provider value={canManage}>
      <SubjectNotesContext.Provider value={ready ? value : null}>
        {children}
        {ready && editor?.surface === 'popover' && (
          <SubjectNotePopover
            key={`${subjectKey(editor.subject)}|${editor.scenarioId}`}
            scope={value}
            target={editor}
          />
        )}
      </SubjectNotesContext.Provider>
    </NotesEnabledContext.Provider>
  )
}
