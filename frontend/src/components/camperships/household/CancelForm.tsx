import { useEffect, useRef, useState } from 'react'

import { AidPicker } from '../kit/AidPicker'
import {
  CANCEL_REASON_OPTIONS,
  choiceProblem,
  REASON_POLICY,
  type CancelReason,
} from '../kit/editor'
import { EditorField, EditorGrid } from '../kit/EditorLayout'
import { HH_GRID_TEXT } from './gridFields'
import { HouseholdForm } from './ReasonForm'

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
  // Esc is heard on the form, so the form takes focus as it opens (on the reason picker), as ReasonForm does.
  const field = useRef<HTMLDivElement>(null)
  useEffect(() => {
    field.current?.querySelector('button')?.focus()
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
    <HouseholdForm
      head={head}
      side={'A note is needed only for "another reason".'}
      submitLabel={submitLabel}
      busy={busy}
      refusals={[tried ? problem : null, error]}
      onSubmit={() => void submit()}
      onCancel={() => {
        if (!inFlight.current) onCancel()
      }}
    >
      <EditorGrid columns={2}>
        <EditorField label={policy.label}>
          <div ref={field} className="w-[330px] max-w-full">
            {/* The kit picker (design-language §3; conformance gap 1), as wide as the mock draws it. */}
            <AidPicker
              label="Cancel reason"
              size="field"
              fill
              value={value}
              onChange={setValue}
              options={[{ value: '', label: 'Pick a reason' }, ...policy.options]}
            />
          </div>
        </EditorField>
        <EditorField label="Note" wide>
          <input
            aria-label="Note"
            type="text"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            className={HH_GRID_TEXT}
          />
        </EditorField>
      </EditorGrid>
    </HouseholdForm>
  )
}
