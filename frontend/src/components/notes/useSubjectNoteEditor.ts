/**
 * One open note editor's state, shared by the popover and the panel section.
 *
 * Inside a scenario it opens on the STANDARD note (owner, 2026-09-25: most
 * notes are "who is coming or requirements", not plan-specific); the
 * plan-only box stays behind "+ Note just for ‹scenario›" until asked for, or
 * until it already holds text.
 */
import { useRef, useState } from 'react'

import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { changedDrafts, type SubjectLayers } from './subjectNoteModel'
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
  /**
   * Resolves true once promoted and closed; false when the write failed or an
   * in-flight call already owns it (the editor stays open). Mirrors `save`
   * (fix round 1, I2) so a caller can tell a real failure from a refusal --
   * without it, a wrapper can never distinguish a rejected promote from a
   * successful one, and so can never safely re-arm itself after one fails.
   */
  promote: () => Promise<boolean>
}

export function useSubjectNoteEditor(
  scope: SubjectNotesScopeValue,
  target: EditorTarget
): SubjectNoteEditorModel {
  const layers = scope.notesFor(target.subject)
  const inScenario = target.scenarioId !== ''

  // The baseline drafts diff against. It tracks `layers` only while the scope
  // is showing the scenario this editor was opened in; if the scope has moved
  // on (still loading another plan, or one already cached) it freezes at the
  // last value that matched, rather than diffing typed text against a
  // different plan's notes -- a hazard the panel (Task 2.9) hits by flushing
  // `save()` from a render exactly one commit behind the scope (see the
  // scope's own "closes any open editor" effect in SubjectNotesScope.tsx).
  const scenarioMatches = scope.scenarioId === target.scenarioId
  const [baseline, setBaseline] = useState<SubjectLayers>(() => layers)
  if (scenarioMatches && baseline !== layers) {
    setBaseline(layers)
  }

  const [standardText, setStandardText] = useState(() => layers.standard?.body ?? '')
  const [planText, setPlanText] = useState(() => layers.plan?.body ?? '')
  const [planExpanded, setPlanExpanded] = useState(
    () => inScenario && (target.want === 'plan' || layers.plan !== undefined)
  )
  const [focus, setFocus] = useState<'standard' | 'plan'>(() =>
    inScenario && target.want === 'plan' ? 'plan' : 'standard'
  )
  const [busy, setBusy] = useState(false)
  // Guards save()/promote() against a second call landing mid-round-trip
  // (Ctrl+Enter twice, or the panel's outside-click save racing a promote) --
  // a ref rather than state so the very next call sees it, with no re-render
  // in between.
  const inFlight = useRef(false)

  const drafts = changedDrafts(baseline, {
    standard: standardText,
    plan: inScenario && planExpanded ? planText : null,
  })
  const dirty = Object.keys(drafts).length > 0

  const discard = () => {
    scope.closeEditor(target)
  }

  const save = async (): Promise<boolean> => {
    if (inFlight.current) return false
    if (!dirty) {
      scope.closeEditor(target)
      return true
    }
    inFlight.current = true
    setBusy(true)
    try {
      await scope.save(target.subject, drafts, target.scenarioId)
      scope.closeEditor(target)
      return true
    } catch {
      // The mutation already toasted; keep the typed text on screen.
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const promote = async (): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    try {
      await scope.promote(target.subject, drafts, target.scenarioId)
      scope.closeEditor(target)
      return true
    } catch {
      // Toasted by the mutation (e.g. the 2000-character refusal); stay open.
      return false
    } finally {
      inFlight.current = false
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
    standardSaved: baseline.standard,
    planSaved: baseline.plan,
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
