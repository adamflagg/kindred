/**
 * One open note editor's state, shared by the popover and the panel section.
 *
 * Inside a scenario it opens on the STANDARD note (owner, 2026-09-25: most
 * notes are "who is coming or requirements", not plan-specific); the
 * plan-only box stays behind "+ Note just for ‹scenario›" until asked for, or
 * until it already holds text.
 */
import { useState } from 'react'

import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { changedDrafts } from './subjectNoteModel'
import type { SubjectNoteRow } from '../../types/subjectNotes'

export interface SubjectNoteEditorModel {
  target: EditorTarget
  inScenario: boolean
  scenarioName: string
  standardText: string
  planText: string
  planExpanded: boolean
  focus: 'standard' | 'plan'
  standardSaved: SubjectNoteRow | undefined
  planSaved: SubjectNoteRow | undefined
  setStandardText: (value: string) => void
  setPlanText: (value: string) => void
  expandPlan: () => void
  dirty: boolean
  busy: boolean
  /** Resolves true once saved and closed; false when the write failed (the editor stays open). */
  save: () => Promise<boolean>
  discard: () => void
  promote: () => Promise<void>
}

export function useSubjectNoteEditor(
  scope: SubjectNotesScopeValue,
  target: EditorTarget
): SubjectNoteEditorModel {
  const layers = scope.notesFor(target.subject)
  const inScenario = target.scenarioId !== ''
  const [standardText, setStandardText] = useState(() => layers.standard?.body ?? '')
  const [planText, setPlanText] = useState(() => layers.plan?.body ?? '')
  const [planExpanded, setPlanExpanded] = useState(
    () => inScenario && (target.want === 'plan' || layers.plan !== undefined)
  )
  const [focus, setFocus] = useState<'standard' | 'plan'>(() =>
    inScenario && target.want === 'plan' ? 'plan' : 'standard'
  )
  const [busy, setBusy] = useState(false)

  const drafts = changedDrafts(layers, {
    standard: standardText,
    plan: inScenario && planExpanded ? planText : null,
  })
  const dirty = Object.keys(drafts).length > 0

  const discard = () => {
    scope.closeEditor(target)
  }

  const save = async (): Promise<boolean> => {
    if (!dirty) {
      scope.closeEditor(target)
      return true
    }
    setBusy(true)
    try {
      await scope.save(target.subject, drafts, target.scenarioId)
      scope.closeEditor(target)
      return true
    } catch {
      // The mutation already toasted; keep the typed text on screen.
      return false
    } finally {
      setBusy(false)
    }
  }

  const promote = async () => {
    setBusy(true)
    try {
      await scope.promote(target.subject, drafts, target.scenarioId)
      scope.closeEditor(target)
    } catch {
      // Toasted by the mutation (e.g. the 2000-character refusal); stay open.
    } finally {
      setBusy(false)
    }
  }

  return {
    target,
    inScenario,
    scenarioName: scope.scenarioName,
    standardText,
    planText,
    planExpanded,
    focus,
    standardSaved: layers.standard,
    planSaved: layers.plan,
    setStandardText,
    setPlanText,
    expandPlan: () => {
      setPlanExpanded(true)
      setFocus('plan')
    },
    dirty,
    busy,
    save,
    discard,
    promote,
  }
}
