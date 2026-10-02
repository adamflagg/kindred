import { useEffect, useRef, useState } from 'react'

import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD,
} from '../../admin/lodging/lodgingStyles'

/** The server's limit on a reason (`_Reason`, 2000). */
const REASON_MAX = 2000

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
}: {
  label: string
  submitLabel: string
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
      <label className="flex min-w-[16rem] flex-1 items-center gap-2">
        {label}
        <input
          ref={field}
          type="text"
          value={note}
          maxLength={REASON_MAX}
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
      {error !== null && <span className={AMBER_NOTE}>{error}</span>}
    </form>
  )
}
