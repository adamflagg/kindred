import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  HH_AMBER_NOTE,
  HH_BUTTON,
  HH_BUTTON_PRIMARY,
  HH_EDITOR_ASIDE,
  HH_EDITOR_BOX,
  HH_EDITOR_COLS,
  HH_EDITOR_CONTAINER,
  HH_EDITOR_FOOT,
  HH_EDITOR_FOOT_END,
  HH_EDITOR_HEAD,
  HH_EDITOR_KEYS,
  HH_EDITOR_LABEL,
  HH_EDITOR_LEFT,
  HH_EDITOR_SIDE,
  HH_EDITOR_SIDE_HEAD,
  HH_EDITOR_TEXT,
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

/** The words under every household editor, as the money editor has always said them. */
export const EDITOR_KEYS = 'Enter saves · Esc cancels'

/**
 * Round 3 (mock section 2, option B): the fields on the left, what saving does on the right, under a
 * small "If you save". With nothing to say on the right, the fields alone.
 */
export function EditorColumns({ side, children }: { side?: ReactNode; children: ReactNode }) {
  if (side === undefined || side === null) return <div className={HH_EDITOR_LEFT}>{children}</div>
  return (
    <div className={HH_EDITOR_CONTAINER}>
      <div className={HH_EDITOR_COLS}>
        <div className={HH_EDITOR_LEFT}>{children}</div>
        <div data-editor-side="" className={HH_EDITOR_SIDE}>
          <div className={HH_EDITOR_SIDE_HEAD}>If you save</div>
          {side}
        </div>
      </div>
    </div>
  )
}

/**
 * A form's footer (the mock's .edfoot): the refusal on the left; the key hint, Back and the submit
 * bottom right, the submit last.
 */
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
    <div className={HH_EDITOR_FOOT}>
      {children}
      <span className={HH_EDITOR_FOOT_END}>
        <span className={HH_EDITOR_KEYS}>{EDITOR_KEYS}</span>
        {/* A write in flight finishes on this form: leaving would drop its refusal unseen. */}
        <button type="button" className={HH_BUTTON} onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button type="submit" className={HH_BUTTON_PRIMARY} disabled={busy}>
          {submitLabel}
        </button>
      </span>
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
  /** What saving does, on the right (the undo's warnings, what a hold does). */
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
            if (!inFlight.current) onCancel()
          }
        }}
      >
        <EditorColumns side={hint}>
          <label className={HH_EDITOR_LABEL}>
            {label}
            <input
              ref={field}
              type="text"
              value={note}
              maxLength={REASON_MAX}
              onChange={(event) => setNote(event.target.value)}
              className={HH_EDITOR_TEXT}
            />
          </label>
        </EditorColumns>
        <FormActions submitLabel={submitLabel} busy={busy} onCancel={onCancel}>
          {error !== null && <span className={HH_AMBER_NOTE}>{error}</span>}
        </FormActions>
      </form>
    </EditorBox>
  )
}
