import { useEffect, useRef, useState } from 'react'

import { CS_BTN, CS_BTN2, CS_FIELD } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { HH_AMBER_NOTE } from '../household/householdStyles'

/** The server's limit on a reason (`_Reason`, 2000). */
const REASON_MAX = 2000

/**
 * A one-line reason for an edit that needs one, in To place's editor grammar (design-language §24; mock
 * `editor`): wide and short, one label and its field, the Title Case buttons on one row with what it does
 * beside them. Leave at Family Level…, Leave With a Note… and Reopen… use it. Enter sends it, Esc goes
 * back, a refusal keeps what was typed and shows the words.
 */
export function ReasonEditor({
  title,
  label,
  submitLabel,
  hint,
  onSubmit,
  onCancel,
  testId,
  cancelLabel = 'Back',
  requiredWords,
}: {
  title: string
  label: string
  submitLabel: string
  /** What sending does, on the buttons' row: "It leaves the open count · Reopen needs a reason". */
  hint: string
  onSubmit: (note: string) => Promise<unknown>
  onCancel: () => void
  testId?: string
  /** The close button's words: Back in To place; Cancel where the page's mock says so (Grants' Withdraw). */
  cancelLabel?: string
  /** What an empty send says; default "<label> is required". Funders' Retire and Unretire: "A reason is required." */
  requiredWords?: string
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // A submit while one is in flight is ignored, so a stale submit's error can never land after a newer one.
  const inFlight = useRef(false)
  useEffect(() => {
    field.current?.focus()
  }, [])

  const submit = async () => {
    if (inFlight.current) return
    const trimmed = note.trim()
    if (trimmed === '') {
      setError(requiredWords ?? `${label} is required`)
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
    <div data-aid-editor="" data-testid={testId}>
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
        <EditorForm
          title={title}
          actions={
            <EditorActions reason={hint}>
              <button type="submit" className={CS_BTN} disabled={busy}>
                {submitLabel}
              </button>
              {/* A write in flight finishes on this form: leaving would drop its refusal unseen. */}
              <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
                {cancelLabel}
              </button>
              {error !== null && <span className={HH_AMBER_NOTE}>{error}</span>}
            </EditorActions>
          }
        >
          <EditorGrid columns={2}>
            <EditorField label={label}>
              <input
                ref={field}
                type="text"
                aria-label={label}
                value={note}
                maxLength={REASON_MAX}
                className={`${CS_FIELD} w-full`}
                onChange={(event) => setNote(event.target.value)}
              />
            </EditorField>
          </EditorGrid>
        </EditorForm>
      </form>
    </div>
  )
}
