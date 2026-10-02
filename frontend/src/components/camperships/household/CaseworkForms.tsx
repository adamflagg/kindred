import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAidApplication } from '../../../hooks/camperships/useAidApplication'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
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
  ACTION_LINK,
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD,
  FIELD_INLINE,
} from '../../admin/lodging/lodgingStyles'
import { parseMoneyInput } from '../kit/editor'
import {
  correctionValue,
  duplicateSurvivors,
  fieldKind,
  headcountOf,
  parseCount,
  parsePercent,
  sessionCandidates,
  sessionName,
} from './caseworkModel'
import type { EditorExits } from './editorExits'
import { answerWords, camperOf } from './householdModel'

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
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
  children,
}: {
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      {children}
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

function ReasonInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-w-[14rem] flex-1 items-center gap-2">
      Reason
      <input
        aria-label="Reason"
        type="text"
        value={value}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
    </label>
  )
}

function Note({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{children}</span>
      <button type="button" className={BUTTON_SECONDARY} onClick={onBack}>
        Back
      </button>
    </div>
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
  const kind = fieldKind(answer)

  /** `raw` null is the way back to the form's figure. */
  const send = (raw: string | null) =>
    attempt(() => {
      if (reason.trim() === '') return REASON_REQUIRED
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
  return (
    <FormShell
      submitLabel="Save the correction"
      busy={busy}
      error={error}
      onSubmit={() => send(value)}
      onCancel={onClose}
    >
      {kind === 'flag' ? (
        <select
          aria-label={label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={FIELD_INLINE}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input
          aria-label={label}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${FIELD_INLINE} w-28 text-right tabular-nums`}
        />
      )}
      <ReasonInput value={reason} onChange={setReason} />
      {answer.corrected && (
        <button type="button" className={ACTION_LINK} disabled={busy} onClick={() => send(null)}>
          Use the form&apos;s figure
        </button>
      )}
    </FormShell>
  )
}

/**
 * "Correct…" on an income answer (main spec §9.3): the corrected figure beside the form's, with a
 * reason. The form mounts only while open, so each opening starts from the answer as it now stands.
 * Opening it first leaves the page's open money editor, when `exits` is given (one open editor).
 */
export function IncomeCorrection({
  page,
  income,
  answer,
  exits,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  answer: ApiAidAnswer
  exits?: EditorExits | undefined
}) {
  const [open, setOpen] = useState(false)
  if (fieldKind(answer) === 'override') return null
  if (!open) {
    return (
      <button
        type="button"
        className={ACTION_LINK}
        onClick={() => {
          if (exits === undefined) setOpen(true)
          else exits.beforeLeave(() => setOpen(true))
        }}
      >
        Correct…
      </button>
    )
  }
  return (
    <CorrectionForm page={page} income={income} answer={answer} onClose={() => setOpen(false)} />
  )
}

/**
 * "Payer shares…" (main spec §9.2): one household's share, as a % or in dollars. With two shares the
 * server fills the other, and a dollar amount becomes a % of the current award. A household not on
 * the page is added by its CampMinder id.
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
  const [mode, setMode] = useState<'pct' | 'amount'>('pct')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()

  const submit = () =>
    attempt(() => {
      const id = parseCount(household === 'other' ? otherId : household, Number.MAX_SAFE_INTEGER)
      if (id.kind === 'invalid' || id.value <= 0) return "Enter the other household's CampMinder id"
      let body: ApiAidHouseholdShareIn
      if (mode === 'pct') {
        const pct = parsePercent(value)
        if (pct.kind === 'invalid') return pct.reason
        body = { share_pct: pct.value, reason: reason.trim() }
      } else {
        const amount = parseMoneyInput(value)
        if (amount.kind === 'invalid') return amount.reason
        if (amount.kind === 'empty') return 'Enter the amount'
        // The server's `gt=0`.
        if (amount.amount <= 0) return 'More than $0'
        body = { amount: String(amount.amount), reason: reason.trim() }
      }
      if (reason.trim() === '') return REASON_REQUIRED
      return () =>
        share
          .mutateAsync({ requestId: request.row.request_id, householdCmId: id.value, body })
          .then(onDone)
    })

  return (
    <FormShell
      submitLabel="Set the share"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className="flex items-center gap-2">
        Household
        <select
          aria-label="Household"
          value={household}
          onChange={(event) => setHousehold(event.target.value)}
          className={FIELD_INLINE}
        >
          {page.households.map((h) => (
            <option key={h.household_cm_id} value={String(h.household_cm_id)}>
              {`${String(h.chip)} · ${h.family_name}`}
            </option>
          ))}
          <option value="other">Another household…</option>
        </select>
      </label>
      {household === 'other' && (
        <label className="flex items-center gap-2">
          CampMinder id
          <input
            aria-label="Household id"
            type="text"
            inputMode="numeric"
            value={otherId}
            onChange={(event) => setOtherId(event.target.value)}
            className={`${FIELD_INLINE} w-28`}
          />
        </label>
      )}
      <label className="flex items-center gap-2">
        Share
        <input
          aria-label="Share"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${FIELD_INLINE} w-24 text-right tabular-nums`}
        />
      </label>
      <select
        aria-label="Share as"
        value={mode}
        onChange={(event) => setMode(event.target.value === 'amount' ? 'amount' : 'pct')}
        className={FIELD_INLINE}
      >
        <option value="pct">%</option>
        <option value="amount">$ of the award</option>
      </select>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/** "Settle session…" (main spec §9.1; Decision 28): one of the candidates intake recorded. */
export function SessionForm({
  request,
  page,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  onDone: () => void
}) {
  const application = useAidApplication(request.row.household_cm_id)
  const names = useAidSessionNames(page.year)
  const resolve = useAidSessionResolve()
  const [session, setSession] = useState('')
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  const candidates = sessionCandidates(application.data, request.row.request_id)
  if (application.isLoading) {
    return <span className="text-muted-foreground text-xs">Loading the candidates…</span>
  }
  if (application.data === undefined) {
    return <Note onBack={onDone}>Couldn&apos;t load this request&apos;s candidate sessions.</Note>
  }
  if (candidates.length === 0) {
    return <Note onBack={onDone}>No candidate sessions are recorded for this request.</Note>
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
      submitLabel="Settle the session"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className="flex items-center gap-2">
        Session
        <select
          aria-label="Session"
          value={session}
          onChange={(event) => setSession(event.target.value)}
          className={FIELD_INLINE}
        >
          <option value="">Pick a session</option>
          {candidates.map((id) => (
            <option key={id} value={String(id)}>
              {sessionName(page, id, names)}
            </option>
          ))}
        </select>
      </label>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/** "Keep the other request…" (main spec §9.2): this request is the duplicate of the one kept. */
export function DuplicateForm({
  request,
  page,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  onDone: () => void
}) {
  const mark = useAidDuplicate()
  const survivors = duplicateSurvivors(page, request)
  const [kept, setKept] = useState(survivors[0]?.row.request_id ?? '')
  const [reason, setReason] = useState('')
  const { busy, error, attempt } = useSubmit()
  if (survivors.length === 0) {
    return (
      <Note onBack={onDone}>
        No other active request for this camper and session is on this page.
      </Note>
    )
  }
  // The kept request can leave the page on a refetch: send only one that is still offered.
  const keptNow = survivors.find((other) => other.row.request_id === kept)?.row.request_id
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
      submitLabel="Mark as the duplicate"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className="flex items-center gap-2">
        Keep
        <select
          aria-label="Keep"
          value={keptNow ?? ''}
          onChange={(event) => setKept(event.target.value)}
          className={FIELD_INLINE}
        >
          {keptNow === undefined && <option value="">Pick a request</option>}
          {survivors.map((other) => (
            <option key={other.row.request_id} value={other.row.request_id}>
              {`${camperOf(other)} · ${other.row.session_name} · ${other.row.request_id}`}
            </option>
          ))}
        </select>
      </label>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}

/** "Headcount…" on a Family Camp request (main spec §8): a reason, typed (Decision 26: no code list exists). */
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
    return <span className="text-muted-foreground text-xs">Loading the headcount…</span>
  }
  // Until the person types, the fields show what the application holds.
  const shownNonInfant = nonInfant ?? (current ? String(current.nonInfant) : '')
  const shownInfant = infant ?? (current ? String(current.infant) : '')
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
      submitLabel="Set the headcount"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
    >
      <label className="flex items-center gap-2">
        Not infants
        <input
          aria-label="Not infants"
          type="text"
          inputMode="numeric"
          value={shownNonInfant}
          onChange={(event) => setNonInfant(event.target.value)}
          className={`${FIELD_INLINE} w-16 text-right`}
        />
      </label>
      <label className="flex items-center gap-2">
        Infants
        <input
          aria-label="Infants"
          type="text"
          inputMode="numeric"
          value={shownInfant}
          onChange={(event) => setInfant(event.target.value)}
          className={`${FIELD_INLINE} w-16 text-right`}
        />
      </label>
      <ReasonInput value={reason} onChange={setReason} />
    </FormShell>
  )
}
