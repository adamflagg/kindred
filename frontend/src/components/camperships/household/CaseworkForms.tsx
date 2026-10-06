import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAidApplication } from '../../../hooks/camperships/useAidApplication'
import {
  useAidCorrection,
  useAidDuplicate,
  useAidHeadcount,
  useAidHouseholdShare,
  useAidSessionResolve,
} from '../../../hooks/camperships/useAidWrites'
import type {
  ApiAidAnswer,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidHouseholdShareIn,
  ApiAidIncome,
} from '../../../types/api-types'
import {
  correctionValue,
  duplicateSurvivors,
  fieldKind,
  headcountOf,
  namedHolder,
  parseCount,
  parsePercent,
} from './caseworkModel'
import type { EditorExits } from './editorExits'
import { correctLabel, correctionPicks, formsSayWords, settleWords } from './formsModel'
import { answerWords, camperOf, labelOf, labelWords } from './householdModel'
import {
  HH_AMBER_NOTE as AMBER_NOTE,
  HH_BUTTON,
  HH_EDITOR_FIELD,
  HH_EDITOR_LABEL,
  HH_EDITOR_MONEY,
  HH_EDITOR_NUMBER,
  HH_EDITOR_PAIR,
  HH_CORRECT_SETTLES,
  HH_EDITOR_TEXT,
  HH_LINK,
  HH_PICK,
  HH_PICK_ON,
} from './householdStyles'
import { EditorBox, EditorColumns, FormActions } from './ReasonForm'

type Write = () => Promise<unknown>

/**
 * Saving and its refusal, for one confirm-style form (PR 8's CancelForm/ReasonForm pattern): one
 * submit outstanding at a time (the ref, so a second Enter in the same tick is ignored too), the
 * server's own words on a refusal, and nothing set after the form is gone. These forms don't register
 * with the page's `leave()`: saving on leave would act without confirmation.
 */
function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  /** `check` returns the problem to show, or the write to send. */
  const attempt = (check: () => string | Write) => {
    if (inFlight.current) return
    const next = check()
    if (typeof next === 'string') {
      setError(next)
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await next()
      } catch (caught) {
        if (mounted.current) setError(caught instanceof Error ? caught.message : "Couldn't save")
      } finally {
        inFlight.current = false
        if (mounted.current) setBusy(false)
      }
    })()
  }
  return { busy, error, attempt }
}

function FormShell({
  head,
  aside,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
  side,
  children,
}: {
  /** The editor box's head (D24): what the form does, in sentence case. */
  head: string
  /** A muted aside beside the head (Correct…: the forms' figures). */
  aside?: string | undefined
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit: () => void
  onCancel: () => void
  /** What saving does, on the right (round 3, two columns); the fields alone without it. */
  side?: ReactNode
  /** The fields, top to bottom: short ones grouped in an `HH_EDITOR_PAIR` row, then the reason. */
  children: ReactNode
}) {
  // Esc is heard on the form, so the form takes focus as it opens, on its first field, as
  // ReasonForm does.
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')?.focus()
  }, [])
  return (
    <EditorBox head={head} aside={aside}>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!busy) onCancel()
          }
        }}
      >
        <EditorColumns side={side}>{children}</EditorColumns>
        <FormActions submitLabel={submitLabel} busy={busy} onCancel={onCancel}>
          {error !== null && <span className={AMBER_NOTE}>{error}</span>}
        </FormActions>
      </form>
    </EditorBox>
  )
}

function ReasonInput({
  value,
  onChange,
  optional = false,
}: {
  value: string
  onChange: (value: string) => void
  /** Say "(optional)" beside the label (Correct…: owner ruling 10-05). */
  optional?: boolean
}) {
  return (
    <label className={HH_EDITOR_LABEL}>
      <span>
        Reason
        {optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
      </span>
      <input
        aria-label="Reason"
        type="text"
        value={value}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        className={HH_EDITOR_TEXT}
      />
    </label>
  )
}

function Note({
  head,
  children,
  onBack,
}: {
  head: string
  children: ReactNode
  onBack: () => void
}) {
  // As FormShell: Esc is heard on the box, so its Back takes focus as it opens.
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    back.current?.focus()
  }, [])
  return (
    <EditorBox head={head}>
      <div
        className="flex flex-wrap items-center gap-2 text-[13px]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onBack()
          }
        }}
      >
        <span className="text-muted-foreground">{children}</span>
        <button ref={back} type="button" className={HH_BUTTON} onClick={onBack}>
          Back
        </button>
      </div>
    </EditorBox>
  )
}

const REASON_REQUIRED = 'A reason is required'

function CorrectionForm({
  page,
  income,
  answer,
  onClose,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  answer: ApiAidAnswer
  onClose: () => void
}) {
  const correct = useAidCorrection()
  const [value, setValue] = useState(answer.effective)
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  const field = useRef<HTMLInputElement & HTMLSelectElement>(null)
  const kind = fieldKind(answer)
  const picks = correctionPicks(page, income, answer)
  // The pick the field holds now, read from the figure itself: typing a form's figure picks it too.
  const same = (a: string, b: string) => {
    const x = correctionValue(kind, a)
    const y = correctionValue(kind, b)
    return x.kind === 'ok' && y.kind === 'ok' && x.value === y.value
  }
  const picked = picks.find((pick) => same(pick.value, value))

  /**
   * `raw` null is the way back to the form's figure: the one-form "The form's $X" pick. A form's
   * figure where the forms disagree goes as a figure, since only a correction settles the conflict.
   * The reason is optional (owner ruling 10-05): blank goes as '', since `CorrectionCreate.reason`
   * is a required string.
   */
  const send = (raw: string | null) =>
    attempt(() => {
      const parsed = correctionValue(kind, raw)
      if (parsed.kind === 'invalid') return parsed.reason
      return () =>
        correct
          .mutateAsync({
            year: page.year,
            householdCmId: income.household_cm_id,
            body: { field: answer.field, new_value: parsed.value, reason: reason.trim() },
          })
          .then(onClose)
    })

  const label = answerWords(answer.field)
  const settles = settleWords(income, answer)
  const used =
    kind === 'flag' ? (
      <select
        ref={field}
        aria-label={label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={HH_EDITOR_FIELD}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    ) : (
      <input
        ref={field}
        aria-label={label}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={HH_EDITOR_MONEY}
      />
    )
  // Round 3 (section 3): one column, as the mock's row in the answers; the picks fill Used.
  return (
    <FormShell
      head={`Correcting · ${label}`}
      aside={formsSayWords(page, income, answer) ?? undefined}
      submitLabel="Save the Correction"
      busy={busy}
      error={error}
      onSubmit={() => send(picked?.revert === true ? null : value)}
      onCancel={onClose}
    >
      <div className={HH_EDITOR_PAIR}>
        {picks.length > 0 && (
          <div className={HH_EDITOR_LABEL}>
            Use
            <span className="flex flex-wrap gap-1.5">
              {picks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  className={`${HH_PICK} ${pick === picked ? HH_PICK_ON : ''}`}
                  disabled={busy}
                  onClick={() => setValue(pick.value)}
                >
                  {pick.label}
                </button>
              ))}
              <button
                type="button"
                className={`${HH_PICK} ${picked === undefined ? HH_PICK_ON : ''}`}
                disabled={busy}
                onClick={() => {
                  field.current?.focus()
                  if (field.current instanceof HTMLInputElement) field.current.select()
                }}
              >
                Another figure
              </button>
            </span>
          </div>
        )}
        <label className={HH_EDITOR_LABEL}>
          Used
          {used}
        </label>
      </div>
      <ReasonInput value={reason} onChange={setReason} optional />
      {settles !== null && <p className={HH_CORRECT_SETTLES}>{settles}</p>}
    </FormShell>
  )
}

/**
 * "Correct…" on an income answer (main spec §9.3): the corrected figure beside the form's, with an
 * optional reason. The form mounts only while open, so each opening starts from the answer as it
 * now stands. Opening it first leaves the page's open money editor, when `exits` is given (one open
 * editor).
 * The income panel holds `open` (`onOpenChange`), so it can draw the form in a row of its own (B30).
 * On an answer the forms still disagree on, the button reads "Choose Which Form…" (household-v4
 * section 3) and opens the same row.
 */
export function IncomeCorrection({
  page,
  income,
  answer,
  exits,
  open: openProp,
  onOpenChange,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  answer: ApiAidAnswer
  exits?: EditorExits | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = onOpenChange ?? setOwnOpen
  if (fieldKind(answer) === 'override') return null
  if (!open) {
    return (
      <button
        type="button"
        // D29: the mock's forest link with a visible dotted underline; no hover reveal.
        className={HH_LINK}
        onClick={() => {
          if (exits === undefined) setOpen(true)
          else exits.beforeLeave(() => setOpen(true))
        }}
      >
        {correctLabel(income, answer)}
      </button>
    )
  }
  return (
    <CorrectionForm page={page} income={income} answer={answer} onClose={() => setOpen(false)} />
  )
}

/**
 * "Payer Shares…" (main spec §9.2): one household's share, as a percentage. With two shares the
 * tool fills the other. A household not on the page is added by its CampMinder id. Percent only:
 * the dollar path needs an award source it is not wired with (review I2).
 */
export function ShareForm({
  request,
  page,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  onDone: () => void
}) {
  const share = useAidHouseholdShare()
  const [household, setHousehold] = useState(String(request.row.household_cm_id))
  const [otherId, setOtherId] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()

  const submit = () =>
    attempt(() => {
      const id = parseCount(household === 'other' ? otherId : household, Number.MAX_SAFE_INTEGER)
      if (id.kind === 'invalid' || id.value <= 0) return "Enter the other household's CampMinder id"
      const pct = parsePercent(value)
      if (pct.kind === 'invalid') return pct.reason
      const body: ApiAidHouseholdShareIn = { share_pct: pct.value, reason: reason.trim() }
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        share
          .mutateAsync({ requestId: request.row.request_id, householdCmId: id.value, body })
          .then(onDone)
    })

  return (
    <FormShell
      head="Payer shares"
      submitLabel="Set the Share"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
      side={
        <>
          With one other household on this request, this tool fills the other household&apos;s
          share. A lone partial share holds the request until a second share is added.
        </>
      }
    >
      <div className={HH_EDITOR_PAIR}>
        <label className={HH_EDITOR_LABEL}>
          Household
          <select
            aria-label="Household"
            value={household}
            onChange={(event) => setHousehold(event.target.value)}
            className={HH_EDITOR_FIELD}
          >
            {page.households.map((h) => {
              // #3025: the label (and its tie-break) tells two households apart; before it, the family name.
              const label = labelOf(h)
              return (
                <option key={h.household_cm_id} value={String(h.household_cm_id)}>
                  {`${String(h.chip)} · ${label === null ? h.family_name : labelWords(label)}`}
                </option>
              )
            })}
            <option value="other">Another household…</option>
          </select>
        </label>
        {household === 'other' && (
          <label className={HH_EDITOR_LABEL}>
            CampMinder id
            <input
              aria-label="Household id"
              type="text"
              inputMode="numeric"
              value={otherId}
              onChange={(event) => setOtherId(event.target.value)}
              className={`${HH_EDITOR_FIELD} w-28`}
            />
          </label>
        )}
        <label className={HH_EDITOR_LABEL}>
          Share
          <span className="inline-flex items-center gap-1.5 font-normal">
            <input
              aria-label="Share"
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={HH_EDITOR_NUMBER}
            />
            %
          </span>
        </label>
      </div>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/**
 * "Settle Session…" (main spec §9.1): one of the candidates intake recorded, named by the server on
 * the row (`GridRowOut.session_candidates`, set while the request is unmatched).
 */
export function SessionForm({
  request,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  onDone: () => void
}) {
  const resolve = useAidSessionResolve()
  const [session, setSession] = useState('')
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  const candidates = request.row.session_candidates ?? []
  if (candidates.length === 0) {
    return (
      <Note head="Settling the session" onBack={onDone}>
        No candidate sessions are recorded for this request.
      </Note>
    )
  }
  const submit = () =>
    attempt(() => {
      if (session === '') return 'Pick the session'
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        resolve
          .mutateAsync({
            requestId: request.row.request_id,
            body: { session_cm_id: Number(session), reason: reason.trim() },
          })
          .then(onDone)
    })
  return (
    <FormShell
      head="Settling the session"
      submitLabel="Settle the Session"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className={HH_EDITOR_LABEL}>
        Session
        <select
          aria-label="Session"
          value={session}
          onChange={(event) => setSession(event.target.value)}
          className={`${HH_EDITOR_FIELD} self-start`}
        >
          <option value="">Pick a session</option>
          {candidates.map((candidate) => (
            <option key={candidate.session_cm_id} value={String(candidate.session_cm_id)}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/** "Keep the Other Request…" (main spec §9.2): this request is the duplicate of the one kept. */
export function DuplicateForm({
  request,
  page,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  onDone: () => void
}) {
  const application = useAidApplication(request.row.household_cm_id)
  const mark = useAidDuplicate()
  const onPage = duplicateSurvivors(page, request)
  // The holder intake named can be on another household's page (the second parent's request): offer
  // it too. The server checks it is active and the same camper, program and session.
  const holder = namedHolder(application.data, request.row.request_id)
  const labelOf = (other: ApiAidHouseholdRequest) =>
    `${camperOf(other)} · ${other.row.session_name} · ${other.row.request_id}`
  // A holder on this page that the match above missed (the read can send a pending row's program as
  // null) is still named as the card it is.
  const holderHere = page.requests.find((other) => other.row.request_id === holder)
  const options = [
    ...onPage.map((other) => ({ id: other.row.request_id, label: labelOf(other) })),
    ...(holder !== '' && !onPage.some((other) => other.row.request_id === holder)
      ? [
          {
            id: holder,
            label:
              holderHere === undefined
                ? `the request intake named · ${holder}`
                : labelOf(holderHere),
          },
        ]
      : []),
  ]
  const [kept, setKept] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  if (options.length === 0) {
    if (application.isLoading)
      return (
        <Note head="Keeping the other request" onBack={onDone}>
          Looking for the request to keep…
        </Note>
      )
    // The intake-named holder is only reachable through this read: a failure is not "nothing here".
    if (application.error) {
      return (
        <Note head="Keeping the other request" onBack={onDone}>
          Couldn&apos;t load the request intake named for this one.
        </Note>
      )
    }
    return (
      <Note head="Keeping the other request" onBack={onDone}>
        No other active request for this camper and session is on this page.
      </Note>
    )
  }
  // The kept request can leave the options on a refetch: send only one that is still offered.
  const keptNow = options.find((option) => option.id === (kept ?? options[0]?.id))?.id
  const submit = () =>
    attempt(() => {
      if (keptNow === undefined) return 'Pick the request to keep'
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        mark
          .mutateAsync({
            requestId: request.row.request_id,
            body: { duplicate_of: keptNow, reason: reason.trim() },
          })
          .then(onDone)
    })
  return (
    <FormShell
      head="Keeping the other request"
      submitLabel="Mark as the Duplicate"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className={HH_EDITOR_LABEL}>
        Keep
        <select
          aria-label="Keep"
          value={keptNow ?? ''}
          onChange={(event) => setKept(event.target.value)}
          className={`${HH_EDITOR_FIELD} self-start`}
        >
          {keptNow === undefined && <option value="">Pick a request</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/**
 * "Keep This Request…" on the request a pending duplicate names (item 11, owner ruling 10-05): keeping
 * this one marks the OTHER as the duplicate, the same write Keep the Other Request… makes from the
 * other card (POST /requests/{other}/duplicate, kept: this one), so its history and its gate are the
 * same. A reason, as there.
 */
export function KeepThisForm({
  request,
  other,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  other: ApiAidHouseholdRequest
  onDone: () => void
}) {
  const mark = useAidDuplicate()
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  const submit = () =>
    attempt(() => {
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        mark
          .mutateAsync({
            requestId: other.row.request_id,
            body: { duplicate_of: request.row.request_id, reason: reason.trim() },
          })
          .then(onDone)
    })
  return (
    <FormShell
      head="Keeping this request"
      submitLabel="Mark the Other as the Duplicate"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
      side={`Marks the other request as the duplicate: ${camperOf(other)} · ${other.row.session_name} · ${other.row.request_id}`}
    >
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/**
 * "Number of People…" (owner pass 3, V6: staff never read "headcount") on a Family Camp request (main spec §8): the two counts and a typed reason. No reason
 * code (item 12, owner ruling 10-05): the server's is optional and staff don't need it, so none is
 * offered or sent.
 */
export function HeadcountForm({
  request,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  onDone: () => void
}) {
  const application = useAidApplication(request.row.household_cm_id)
  const set = useAidHeadcount()
  const current = headcountOf(application.data, request.row.request_id)
  const [nonInfant, setNonInfant] = useState<string | null>(null)
  const [infant, setInfant] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  if (application.isLoading) {
    return (
      <Note head="Number of people" onBack={onDone}>
        Loading the number of people…
      </Note>
    )
  }
  // Fields over figures that never loaded would be typed blind.
  if (current === null) {
    return (
      <Note head="Number of people" onBack={onDone}>
        Couldn&apos;t load this request&apos;s number of people.
      </Note>
    )
  }
  // Until the person types, the fields show what the application holds.
  const shownNonInfant = nonInfant ?? String(current.nonInfant)
  const shownInfant = infant ?? String(current.infant)
  const submit = () =>
    attempt(() => {
      // The server's own limits (HeadcountSet): 0–50 and 0–20, and at least one person.
      const adults = parseCount(shownNonInfant, 50)
      const babies = parseCount(shownInfant, 20)
      if (adults.kind === 'invalid') return `Not infants: ${adults.reason}`
      if (babies.kind === 'invalid') return `Infants: ${babies.reason}`
      if (adults.value + babies.value === 0) return 'A family needs at least one person'
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        set
          .mutateAsync({
            requestId: request.row.request_id,
            body: {
              non_infant: adults.value,
              infant: babies.value,
              source: 'override',
              reason: reason.trim(),
            },
          })
          .then(onDone)
    })
  return (
    <FormShell
      head="Number of people"
      submitLabel="Set the Number of People"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <div className={HH_EDITOR_PAIR}>
        <label className={HH_EDITOR_LABEL}>
          Not infants
          <input
            aria-label="Not infants"
            type="text"
            inputMode="numeric"
            value={shownNonInfant}
            onChange={(event) => setNonInfant(event.target.value)}
            className={HH_EDITOR_NUMBER}
          />
        </label>
        <label className={HH_EDITOR_LABEL}>
          Infants
          <input
            aria-label="Infants"
            type="text"
            inputMode="numeric"
            value={shownInfant}
            onChange={(event) => setInfant(event.target.value)}
            className={HH_EDITOR_NUMBER}
          />
        </label>
      </div>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}
