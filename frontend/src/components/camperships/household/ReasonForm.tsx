import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  HH_AMBER_NOTE,
  HH_BUTTON,
  HH_BUTTON_PRIMARY,
  HH_EDITOR_ASIDE,
  HH_EDITOR_BOX,
  HH_EDITOR_HEAD,
  HH_FIELD_TEXT,
  HH_FORM_LABEL,
  HH_FORM_ROW,
} from './householdStyles'

/** The server's limit on a reason (`_Reason`, 2000). */
const REASON_MAX = 2000

/**
 * The editor box (D23, D24; the mock's .editor): every form on a card or banner sits in it, under an
 * uppercase head ("Editing · Round 2") with an optional muted aside.
 */
export function EditorBox({
  head,
  aside,
  children,
}: {
  head: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div data-editor-box="" className={HH_EDITOR_BOX}>
      <div className={HH_EDITOR_HEAD}>
        <span>{head}</span>
        {aside !== undefined && <span className={HH_EDITOR_ASIDE}>{aside}</span>}
      </div>
      {children}
    </div>
  )
}

/** A form's Back and submit row (the mock's .acts), and the refusal beside them. */
export function FormActions({
  submitLabel,
  busy,
  onCancel,
  children,
}: {
  submitLabel: string
  busy: boolean
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <button type="submit" className={HH_BUTTON_PRIMARY} disabled={busy}>
        {submitLabel}
      </button>
      <button type="button" className={HH_BUTTON} onClick={onCancel}>
        Back
      </button>
      {children}
    </div>
  )
}

/**
 * A one-line reason for an edit that needs one (D22; main spec §14.4): undoing a tick, releasing or
 * placing a hold, finance's Round 3 decision, reopening. Enter sends it, Esc goes back. A refusal
 * keeps what was typed and shows the server's words.
 */
export function ReasonForm({
  label,
  submitLabel,
  onSubmit,
  onCancel,
  required = true,
  initial = '',
  head,
  hint,
}: {
  label: string
  submitLabel: string
  /** The box's head; the submit's words when none is given. */
  head?: string | undefined
  /** What the form says first, under its head (the undo's warnings). */
  hint?: ReactNode
  onSubmit: (note: string) => Promise<unknown>
  onCancel: () => void
  required?: boolean
  initial?: string
}) {
  const [note, setNote] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // A submit while one is in flight is ignored, so a stale submit's error can never land after a
  // newer one: there is only ever one submit outstanding.
  const inFlight = useRef(false)
  useEffect(() => {
    field.current?.focus()
  }, [])

  const submit = async () => {
    if (inFlight.current) return
    const trimmed = note.trim()
    if (required && trimmed === '') {
      setError(`${label} is required`)
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <EditorBox head={head ?? submitLabel}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        {hint !== undefined && (
          <div className="text-muted-foreground mb-2 text-[12.5px]">{hint}</div>
        )}
        <div className={HH_FORM_ROW}>
          <label className={HH_FORM_LABEL}>
            {label}
            <input
              ref={field}
              type="text"
              value={note}
              maxLength={REASON_MAX}
              onChange={(event) => setNote(event.target.value)}
              className={HH_FIELD_TEXT}
            />
          </label>
        </div>
        <FormActions submitLabel={submitLabel} busy={busy} onCancel={onCancel}>
          {error !== null && <span className={HH_AMBER_NOTE}>{error}</span>}
        </FormActions>
      </form>
    </EditorBox>
  )
}
