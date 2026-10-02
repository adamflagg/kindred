import { useRef, useState } from 'react'

import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD,
  FIELD_INLINE,
} from '../../admin/lodging/lodgingStyles'
import {
  CANCEL_REASON_OPTIONS,
  choiceProblem,
  REASON_POLICY,
  type CancelReason,
} from '../kit/editor'

/**
 * The cancel form (§6.3; D101, D141; Decision 24): one of the nine reasons, as the server's
 * `CancellationIn` types them, with a note only "another reason" needs.
 */
export function CancelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { readonly reason: CancelReason | null; readonly note: string } | null
  submitLabel: string
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
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
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
      <label className="flex items-center gap-2">
        {policy.label}
        <select
          aria-label="Cancel reason"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={FIELD_INLINE}
        >
          <option value="">Pick a reason</option>
          {policy.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[12rem] flex-1 items-center gap-2">
        Note
        <input
          aria-label="Note"
          type="text"
          value={note}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          className={FIELD}
        />
      </label>
      <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
        {submitLabel}
      </button>
      <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
        Back
      </button>
      {tried && problem !== null && <span className={AMBER_NOTE}>{problem}</span>}
      {error !== null && <span className={AMBER_NOTE}>{error}</span>}
    </form>
  )
}
