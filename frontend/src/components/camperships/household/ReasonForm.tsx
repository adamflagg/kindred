import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import { CS_BTN, CS_BTN2, CS_FIELD, CS_PHEAD } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { HH_AMBER_NOTE } from './householdStyles'

/** The server's limit on a reason (`_Reason`, 2000). */
const REASON_MAX = 2000

/** The words under every household editor, as the money editor has always said them. */
export const EDITOR_KEYS = 'Enter saves · Esc cancels'

/** A refusal on the buttons' row: amber, cut with its words in a title when the row runs out. */
const REFUSAL = `${HH_AMBER_NOTE} min-w-0 truncate`
/** The key hint and any other sentence, at the row's right end, cut with a title. */
const ROW_END = 'text-muted-foreground ml-auto min-w-0 truncate pl-2 text-xs'

/**
 * Every household editor (owner 10-10; conformance.html #g6): the kit's EditorForm, band-tinted because
 * it opens inside a white card ("white on not white, and green on white": `onWhite`). The head is the
 * uppercase panel head with an optional muted aside. The fields go in an EditorGrid, labels beside
 * them. What saving does sits in the right column under "If you save". The buttons are one row: the
 * action first, then Back, a refusal after Back, and the key hint (with any other sentence) at the
 * row's end. Inside the form's @container, below 40rem, the right column stacks under the fields.
 * Esc goes back unless a write is in flight (its refusal must be seen).
 */
export function HouseholdForm({
  head,
  aside,
  side,
  submitLabel,
  busy,
  refusals = [],
  foot,
  keys = EDITOR_KEYS,
  onSubmit,
  onCancel,
  formRef,
  children,
}: {
  /** What the form does, in sentence case ("Putting it on hold"); drawn as the uppercase panel head. */
  head: string
  /** A muted aside beside the head (whose request it is; the forms' figures). */
  aside?: string | undefined
  /** What saving does, on the right under "If you save"; one column without it. */
  side?: ReactNode
  submitLabel: string
  busy: boolean
  /** Why a save was refused, and a failed save's words: after Back, each cut with a title. */
  refusals?: ReadonlyArray<string | null | undefined>
  /** Another sentence for the row's end, before the key hint ("This settles the last answer…"). */
  foot?: string | null | undefined
  keys?: string
  onSubmit: () => void
  onCancel: () => void
  formRef?: Ref<HTMLFormElement> | undefined
  /** The fields: an EditorGrid of EditorFields. */
  children: ReactNode
}) {
  const end = [foot, keys].filter(Boolean).join(' · ')
  return (
    <form
      ref={formRef}
      data-editor-box=""
      className="@container"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          if (!busy) onCancel()
        }
      }}
    >
      <EditorForm
        onWhite
        heading="phead"
        title={
          <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
            <span>{head}</span>
            {aside !== undefined && (
              <span
                className="text-muted-foreground min-w-0 truncate font-normal tracking-normal normal-case"
                title={aside}
              >
                {aside}
              </span>
            )}
          </span>
        }
        side={
          side === undefined || side === null ? undefined : (
            <div data-editor-side="" className="text-[13.5px] leading-[19.5px]">
              <span className={`${CS_PHEAD} block`}>If you save</span>
              {side}
            </div>
          )
        }
        actions={
          <EditorActions>
            <button type="submit" className={CS_BTN} disabled={busy}>
              {submitLabel}
            </button>
            {/* A write in flight finishes on this form: leaving would drop its refusal unseen. */}
            <button type="button" className={CS_BTN2} onClick={onCancel} disabled={busy}>
              Back
            </button>
            {refusals.map((words) =>
              words ? (
                <span key={words} className={REFUSAL} title={words}>
                  {words}
                </span>
              ) : null
            )}
            <span className={ROW_END} title={end}>
              {end}
            </span>
          </EditorActions>
        }
      >
        {children}
      </EditorForm>
    </form>
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
  requiredWords,
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
  /** What an empty send says; "<label> is required" by default (rev 3: "Say why you're refusing"). */
  requiredWords?: string | undefined
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

  // Conformance #g6 (owner 10-10): the Keep This Request pattern, one label beside its field, the
  // hint on the right. Hold, Lift, Give a Reason, Change the Reason and Reopen all use it.
  return (
    <HouseholdForm
      head={head ?? submitLabel}
      side={hint}
      submitLabel={submitLabel}
      busy={busy}
      refusals={[error]}
      onSubmit={() => void submit()}
      onCancel={() => {
        if (!inFlight.current) onCancel()
      }}
    >
      <EditorGrid columns={2}>
        <EditorField label={label}>
          <input
            ref={field}
            type="text"
            aria-label={label}
            value={note}
            maxLength={REASON_MAX}
            onChange={(event) => setNote(event.target.value)}
            className={`${CS_FIELD} w-full`}
          />
        </EditorField>
      </EditorGrid>
    </HouseholdForm>
  )
}
