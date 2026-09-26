import { StickyNote, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { SubjectNoteRow } from '../../types/subjectNotes'
import { PlanNotePill } from './PlanNotePill'
import { editedLine, NOTE_LABEL, NOTE_MAX } from './subjectNoteModel'
import type { SubjectNoteEditorModel } from './useSubjectNoteEditor'

function NoteBox({
  layer,
  value,
  onChange,
  saved,
}: {
  layer: 'standard' | 'plan'
  value: string
  onChange: (value: string) => void
  saved: SubjectNoteRow | undefined
}) {
  const plan = layer === 'plan'
  return (
    <div className="flex flex-col gap-1">
      <textarea
        data-layer={layer}
        aria-label={plan ? 'Note just for this plan' : NOTE_LABEL}
        rows={3}
        maxLength={NOTE_MAX}
        value={value}
        placeholder={plan ? 'Only this plan sees this…' : 'Age, requests, who is coming…'}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        // Sticky-pad yellow (owner, 2026-09-25); a plan-only note is paler and dashed.
        className={`min-h-16 w-full resize-y rounded-lg border px-2.5 py-1.5 text-sm leading-snug text-stone-900 focus:border-yellow-500 focus:outline-none ${
          plan ? 'border-dashed border-yellow-400 bg-yellow-50' : 'border-yellow-200 bg-yellow-100'
        }`}
      />
      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{editedLine(saved)}</span>
        <span className="tabular-nums">
          {value.length}/{NOTE_MAX}
        </span>
      </div>
    </div>
  )
}

export function SubjectNoteEditor({
  model,
  framed,
}: {
  model: SubjectNoteEditorModel
  /** The popover draws its own frame and title bar; the panel section does not. */
  framed: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Focus the requested box when the editor opens or the plan box expands.
  useEffect(() => {
    const box = rootRef.current?.querySelector<HTMLTextAreaElement>(
      `textarea[data-layer="${model.focus}"]`
    )
    if (box) {
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    }
  }, [model.focus, model.planExpanded])

  return (
    <div
      ref={rootRef}
      data-note-editor
      className={
        framed
          ? 'bg-popover text-popover-foreground border-border shadow-lodge-lg rounded-xl border'
          : 'border-border bg-card rounded-xl border'
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          void model.save()
        }
      }}
    >
      {framed && (
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <StickyNote className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 truncate text-sm">
            <span className="font-semibold">{NOTE_LABEL}</span>
            <span className="text-muted-foreground"> · {model.target.label}</span>
          </span>
          <button
            type="button"
            aria-label="Close note"
            onClick={model.discard}
            className="text-muted-foreground hover:bg-muted ml-auto rounded-lg p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3 p-3">
        <NoteBox
          layer="standard"
          value={model.standardText}
          onChange={model.setStandardText}
          saved={model.standardSaved}
        />
        {model.inScenario &&
          (model.planExpanded ? (
            <div className="flex flex-col gap-1">
              <div>
                <PlanNotePill name={model.scenarioName} />
              </div>
              <NoteBox
                layer="plan"
                value={model.planText}
                onChange={model.setPlanText}
                saved={model.planSaved}
              />
              {model.planText.trim() !== '' && (
                <button
                  type="button"
                  disabled={model.busy}
                  onClick={() => {
                    void model.promote()
                  }}
                  className="border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground self-start rounded-full border px-2 py-0.5 text-xs font-medium"
                >
                  Keep on all plans
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={model.expandPlan}
              className="text-forest-700 self-start text-xs font-medium hover:underline"
            >
              + Note just for {model.scenarioName}
            </button>
          ))}
      </div>
      <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2">
        <span className="text-muted-foreground text-[11px]">
          {framed
            ? 'Ctrl/⌘+Enter or clicking away saves · Esc discards'
            : 'Ctrl/⌘+Enter saves · Esc discards'}
        </span>
        <button
          type="button"
          onClick={model.discard}
          className="btn-ghost ml-auto !px-2.5 !py-1 !text-[12.5px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={model.busy}
          onClick={() => {
            void model.save()
          }}
          className="btn-primary !rounded-[.6rem] !px-3 !py-1 !text-[12.5px]"
        >
          Save
        </button>
      </div>
    </div>
  )
}
