import { useEffect, useRef, useState } from 'react'

import {
  CANCEL_REASON_OPTIONS,
  choiceProblem,
  REASON_POLICY,
  type CancelReason,
} from '../kit/editor'
import {
  HH_AMBER_NOTE as AMBER_NOTE,
  HH_FIELD,
  HH_FIELD_TEXT,
  HH_FORM_LABEL,
  HH_FORM_ROW,
} from './householdStyles'
import { EditorBox, FormActions } from './ReasonForm'

/**
 * The cancel form (§6.3; D101, D141; Decision 24): one of the nine reasons, as the server's
 * `CancellationIn` types them, with a note only "another reason" needs.
 */
export function CancelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  head = 'Cancelling the request',
}: {
  initial: { readonly reason: CancelReason | null; readonly note: string } | null
  submitLabel: string
  head?: string
  onSubmit: (reason: CancelReason, note: string) => Promise<unknown>
  onCancel: () => void
}) {
  const policy = REASON_POLICY.cancel
  const [value, setValue] = useState<string>(initial?.reason ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One submit outstanding at a time, so a stale submit's error never lands after a newer one.
  const inFlight = useRef(false)
  // Esc is heard on the form, so the form takes focus as it opens, as ReasonForm does.
  const field = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [])
  const problem = choiceProblem(policy, value === '' ? null : value, note)
  const option = CANCEL_REASON_OPTIONS.find((o) => o.value === value)

  const submit = async () => {
    if (inFlight.current) return
    setTried(true)
    if (problem !== null || option === undefined) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await onSubmit(option.value, note.trim())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <EditorBox head={head}>
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
        <div className={HH_FORM_ROW}>
          <label className={HH_FORM_LABEL}>
            {policy.label}
            <select
              ref={field}
              aria-label="Cancel reason"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={HH_FIELD}
            >
              <option value="">Pick a reason</option>
              {policy.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={HH_FORM_LABEL}>
            Note
            <input
              aria-label="Note"
              type="text"
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              className={HH_FIELD_TEXT}
            />
          </label>
        </div>
        <FormActions submitLabel={submitLabel} busy={busy} onCancel={onCancel}>
          {tried && problem !== null && <span className={AMBER_NOTE}>{problem}</span>}
          {error !== null && <span className={AMBER_NOTE}>{error}</span>}
        </FormActions>
      </form>
    </EditorBox>
  )
}
