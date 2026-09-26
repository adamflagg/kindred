/**
 * The Note section of a slide-in details panel (owner, 2026-09-25): FIRST in
 * the panel body, and ABSENT until a note exists -- the card corner is how the
 * first note is added.
 *
 * Editing happens in place with the shared editor. It holds an overlay token
 * (`useOverlayEscape`), acquired after the panel's own, so Escape reverts the
 * edit before the panel closes. A pending edit is flushed (saved) when the
 * panel closes under it.
 *
 * `look` follows the host panel: `camper` mirrors CamperDetailsPanel's
 * rounded SectionHeader band; `family` mirrors PanelSection's `Section`.
 * The note text is deliberately NOT italic, so it never reads like the
 * CampMinder blockquotes further down the panel.
 */
import { StickyNote } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import type { NoteSubject } from '../../types/subjectNotes'
import { PlanNotePill } from './PlanNotePill'
import {
  useSubjectNotesScope,
  type EditorTarget,
  type SubjectNotesScopeValue,
} from './subjectNotesContext'
import {
  displayScenarioName,
  editedLine,
  NOTE_LABEL,
  subjectKey,
  type SubjectLayers,
} from './subjectNoteModel'
import { SubjectNoteEditor } from './SubjectNoteEditor'
import { useSubjectNoteEditor, type SubjectNoteEditorModel } from './useSubjectNoteEditor'

function PanelEditor({ scope, target }: { scope: SubjectNotesScopeValue; target: EditorTarget }) {
  const model = useSubjectNoteEditor(scope, target)
  const latest = useRef(model)
  useLayoutEffect(() => {
    latest.current = model
  })
  /** Save, Cancel, Escape or promote ended the edit on purpose. */
  const settled = useRef(false)
  const mounted = useRef(false)
  // Focus restore (F5, frontend/CLAUDE.md): mirrors ConfirmActionPopover's
  // capture-on-open, restore-on-close -- there is no anchor element to focus
  // instead here, unlike the popover's corner button. A LAYOUT effect, not a
  // passive one: `SubjectNoteEditor`'s own autofocus (below, in its child)
  // runs in a passive effect too, and EVERY layout effect in the tree fires
  // before ANY passive one -- a passive effect here would already see the
  // textarea it just focused, not whatever was focused before this editor
  // opened.
  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => {
      previouslyFocused?.focus()
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Deferred one microtask: StrictMode's dev double-invoke remounts
      // synchronously, so `mounted` is true again by then and nothing fires.
      // A real unmount (the panel closed or switched family) flushes.
      queueMicrotask(() => {
        if (mounted.current || settled.current) return
        const current = latest.current
        if (current.dirty) void current.save()
        else current.discard()
      })
    }
  }, [])

  const wrapped: SubjectNoteEditorModel = {
    ...model,
    save: async () => {
      // A call landing while an earlier save OR promote is still in flight
      // must not touch `settled` at all (fix round 1, I1): the hook's own
      // `inFlight` guard already refuses it and resolves false, and if we let
      // that refusal flip `settled` back to false, a settle from the FIRST
      // (still in-flight) call arrives later and leaves `settled` wrong --
      // the unmount flush then fires again and writes a duplicate. `busy` is
      // read straight off `model` (not a ref): `wrapped` is rebuilt every
      // render, and `setBusy` commits before any later, separate user event
      // can reach this closure, so it is never stale here.
      if (model.busy) return false
      settled.current = true
      const saved = await model.save()
      if (!saved) settled.current = false
      return saved
    },
    discard: () => {
      settled.current = true
      model.discard()
    },
    promote: async () => {
      if (model.busy) return false
      settled.current = true
      const ok = await model.promote()
      if (!ok) settled.current = false
      return ok
    },
  }
  useOverlayEscape(true, wrapped.discard)
  return <SubjectNoteEditor model={wrapped} framed={false} />
}

function ReadView({
  layers,
  scenarioId,
  scenarioName,
  onEdit,
}: {
  layers: SubjectLayers
  scenarioId: string
  scenarioName: string
  onEdit: (want?: 'plan') => void
}) {
  const link = 'text-forest-700 self-start text-xs font-medium hover:underline'
  return (
    <>
      {layers.standard && (
        <button
          type="button"
          onClick={() => {
            onEdit()
          }}
          className="flex w-full flex-col gap-0.5 rounded-lg border border-yellow-200 bg-yellow-100 px-2 py-1.5 text-left hover:bg-yellow-200/70"
        >
          <span className="text-sm whitespace-pre-wrap text-stone-900">{layers.standard.body}</span>
          <span className="text-[11px] text-stone-600">{editedLine(layers.standard)}</span>
        </button>
      )}
      {layers.plan && (
        <button
          type="button"
          onClick={() => {
            onEdit('plan')
          }}
          className="flex w-full flex-col gap-0.5 rounded-lg border border-dashed border-yellow-400 bg-yellow-50 px-2 py-1.5 text-left hover:bg-yellow-100"
        >
          <span className="flex">
            <PlanNotePill name={displayScenarioName(scenarioName)} small />
          </span>
          <span className="text-sm whitespace-pre-wrap text-stone-900">{layers.plan.body}</span>
          <span className="text-[11px] text-stone-600">{editedLine(layers.plan)}</span>
        </button>
      )}
      {!layers.standard && (
        <button
          type="button"
          className={link}
          onClick={() => {
            onEdit()
          }}
        >
          + Add note for all plans
        </button>
      )}
      {scenarioId !== '' && !layers.plan && (
        <button
          type="button"
          className={link}
          onClick={() => {
            onEdit('plan')
          }}
        >
          + Note just for {displayScenarioName(scenarioName)}
        </button>
      )}
    </>
  )
}

export function SubjectNotesSection({
  subject,
  label,
  look,
}: {
  subject: NoteSubject
  label: string
  look: 'camper' | 'family'
}) {
  const scope = useSubjectNotesScope()
  if (scope === null) return null

  const layers = scope.notesFor(subject)
  const key = subjectKey(subject)
  const editing =
    scope.editor?.surface === 'panel' && subjectKey(scope.editor.subject) === key
      ? scope.editor
      : null
  if (editing === null && !layers.standard && !layers.plan) return null

  const edit = (want?: 'plan') => {
    scope.openEditor({
      subject,
      label,
      surface: 'panel',
      anchorEl: null,
      ...(want ? { want } : {}),
    })
  }
  const inner = editing ? (
    // Keyed by subject AND scenario: the editor hook seeds its text state
    // once, so a stale render after switching scenarios on the SAME subject
    // must remount rather than diff-against a new baseline while still
    // showing the old typed draft (see the popover's identical key).
    <PanelEditor key={`${key}|${editing.scenarioId}`} scope={scope} target={editing} />
  ) : (
    <ReadView
      layers={layers}
      scenarioId={scope.scenarioId}
      scenarioName={scope.scenarioName}
      onEdit={edit}
    />
  )

  if (look === 'camper') {
    return (
      <section data-notes-section>
        <div className="flex w-full items-center rounded-xl bg-stone-100 p-2.5 text-stone-700 dark:bg-stone-700/60 dark:text-stone-100">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4" />
            <h3 className="text-xs font-bold tracking-wider uppercase">{NOTE_LABEL}</h3>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-1.5 pl-1">{inner}</div>
      </section>
    )
  }
  return (
    <section data-notes-section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
        <StickyNote className="h-3.5 w-3.5" />
        {NOTE_LABEL}
      </h3>
      {inner}
    </section>
  )
}
