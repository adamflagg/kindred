import { useId, useRef, useState } from 'react'

import { useAidAddRequest } from '../../../hooks/camperships/useAidIntakeWrites'
import { useAidProgramPool } from '../../../hooks/camperships/useAidProgramNames'
import { useYear } from '../../../hooks/useCurrentYear'
import { AidPicker } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FIELD, CS_POPEN_META } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import {
  EditorActions,
  EditorCheck,
  EditorField,
  EditorForm,
  EditorGrid,
} from '../kit/EditorLayout'
import { Effects } from '../kit/Effects'
import { formatMoney } from '../kit/money'
import {
  addBody,
  addedStatus,
  addEffects,
  addProblem,
  askSource,
  sessionOptions,
  startDraft,
  type AddDraft,
  type AddTarget,
  type SessionIndex,
} from './intakeModel'

const KEYS = 'Enter saves · Esc cancels'

/**
 * Add a Request… (spec 71 §2.4; the form-intake mock): the kit's white EditorForm, opened in a row's cream (Form
 * intake, Season's line, Find a Camper Not Listed…). Session · Ask · (Round 1) · Reason on the left, what saving does
 * on the right, Title Case buttons with one amber problem beside them once a save is tried (RequestEditor's grammar).
 * The Session picker offers only the gap sessions; a held one is shown switched off under "Already held" (design
 * rule 3). On a session CampMinder already paid, Round 1 is offered ticked (owner Q5-A).
 */
export function AddRequestEditor({
  target,
  names,
  onSaved,
  onCancel,
  onWhite = false,
}: {
  target: AddTarget
  /** Inside a white card (Find a Camper Not Listed…'s panel): the band tint, "green on white". */
  onWhite?: boolean
  names: SessionIndex
  /** The toolbar status words after a save; the page keeps the row in view. */
  onSaved: (status: string) => void
  onCancel: () => void
}) {
  const year = useYear()
  const add = useAidAddRequest()
  const poolOf = useAidProgramPool()
  const [draft, setDraft] = useState<AddDraft>(() => startDraft(target))
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const askId = useId()
  const reasonId = useId()
  const checkId = useId()

  const set = (patch: Partial<AddDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }
  const program = target.gap.find((g) => g.session_cm_id === draft.session)?.program_key
  const poolWords = program === undefined ? null : poolOf(program)
  const cm = draft.session === null ? undefined : target.campminder.get(draft.session)
  const cmOn = draft.session === null ? undefined : target.campminderOn.get(draft.session)
  const problem = tried ? addProblem(draft) : null
  const options = sessionOptions(target, names)
  const household = target.person_cm_id === 0

  const save = async () => {
    if (inFlight.current) return
    setTried(true)
    if (addProblem(draft) !== null || draft.session === null) return
    const body = addBody(target, draft)
    inFlight.current = true
    setError(null)
    try {
      await add.mutateAsync({ year, body })
      onSaved(
        addedStatus(
          target,
          body.session_cm_id,
          body.ask,
          body.round1_campminder ?? null,
          names,
          poolWords
        )
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't add the request")
    } finally {
      inFlight.current = false
    }
  }

  const effects = addEffects(target, draft, names, poolWords).map((e) => ({
    sym: e.sym,
    text: (
      <>
        {e.lead !== '' && <b>{e.lead}</b>}
        {e.rest}
      </>
    ),
    then: e.then,
  }))
  const refusal = problem ?? error

  return (
    <form
      data-aid-editor=""
      className="mt-2 max-w-[1100px]"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          if (!inFlight.current) onCancel()
        }
      }}
    >
      <EditorForm
        onWhite={onWhite}
        heading="phead"
        title={
          household
            ? `Add a Household Request · ⌂ ${target.household_label}`
            : `Add a Request · ${target.camper_name}`
        }
        side={<Effects items={effects} />}
        actions={
          <EditorActions>
            <button type="submit" className={CS_BTN} disabled={add.isPending}>
              Add Request
            </button>
            <button type="button" className={CS_BTN2} onClick={onCancel} disabled={add.isPending}>
              Cancel
            </button>
            {refusal !== null && (
              <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={refusal}>
                {refusal}
              </span>
            )}
            <span className={`${CS_POPEN_META} ml-auto`}>{KEYS}</span>
          </EditorActions>
        }
      >
        <EditorGrid>
          <EditorField label="Session">
            <AidPicker
              label="Session"
              size="field"
              value={draft.session === null ? '' : String(draft.session)}
              placeholder="Pick a session"
              options={options}
              onChange={(value) => {
                const id = Number(value)
                if (!Number.isInteger(id) || id <= 0) return
                // A session CampMinder paid, with no registration ask: the ask follows its amount.
                const paid = target.campminder.get(id)
                set(
                  target.registration_ask === null && paid !== undefined
                    ? { session: id, ask: String(paid) }
                    : { session: id }
                )
              }}
            />
          </EditorField>
          <EditorField label="Ask" htmlFor={askId}>
            <span className="flex min-w-0 items-center gap-2">
              <input
                id={askId}
                aria-label="Ask"
                inputMode="decimal"
                className={`${CS_FIELD} w-24 text-right tabular-nums`}
                value={draft.ask}
                onChange={(event) => set({ ask: event.target.value })}
              />
              <span
                className={`${CS_POPEN_META} min-w-0 truncate`}
                title={askSource(target, draft)}
              >
                {askSource(target, draft)}
              </span>
            </span>
          </EditorField>
          {cm !== undefined && (
            <EditorCheck
              id={checkId}
              label="Round 1"
              checked={draft.recordRound1}
              onChange={(checked) => set({ recordRound1: checked })}
            >
              {`Record CampMinder's ${formatMoney(cm)} as Round 1, posted${cmOn ? ` (${formatShortDate(cmOn)})` : ''}`}
            </EditorCheck>
          )}
          <EditorField label="Reason" htmlFor={reasonId} wide>
            <input
              id={reasonId}
              aria-label="Reason"
              type="text"
              maxLength={2000}
              className={`${CS_FIELD} w-full`}
              placeholder="Why the dashboard should hold this request"
              value={draft.reason}
              onChange={(event) => set({ reason: event.target.value })}
            />
          </EditorField>
        </EditorGrid>
      </EditorForm>
    </form>
  )
}
