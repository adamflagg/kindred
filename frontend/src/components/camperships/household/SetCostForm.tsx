import { useState } from 'react'

import { useAidCostOverride } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { costReasonOptions } from '../kit/costReasons'
import { parseMoneyInput } from '../kit/editor'
import { formatMoney } from '../kit/money'
import { FormShell } from './CaseworkForms'
import {
  HH_EDITOR_FIELD,
  HH_EDITOR_LABEL,
  HH_EDITOR_MONEY,
  HH_EDITOR_SIDE_LEAD,
  HH_EDITOR_SIDE_NOTE,
  HH_EDITOR_TEXT,
  HH_NOTE,
} from './householdStyles'
import { useSubmit } from './useSubmit'

/** The server's limit on a note (`_Note`, 2000). */
const NOTE_MAX = 2000
const NOTE_REQUIRED = 'A note is required'
const POSTED_WARNING =
  'A round is already posted: this cost changes the later rounds, never the money already posted.'

/** Whether any round of the request is posted: a new cost never moves that money. */
function anyPosted(request: ApiAidHouseholdRequest): boolean {
  return request.row.rounds.some((round) => round.status === 'posted' || round.posted !== null)
}

/** What the rules price the request at, and where from; null when they can't price it. */
function rulesPrice(request: ApiAidHouseholdRequest): { amount: string; source: string } | null {
  const { rules_cost: cost, rules_cost_from: from } = request.row
  if (cost === null || cost === undefined) return null
  return {
    amount: formatMoney(cost),
    source: from === 'per_person' ? 'from the per-person rates' : 'the catalog price',
  }
}

interface FormProps {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  onDone: () => void
}

/**
 * "Set Cost…" (cost override v2, spec section 10): the cost to price the request at, a reason from
 * the season's list and a required note. The right column says what saving does, against the price
 * the rules give it (or the cost staff already set).
 */
export function SetCostForm({ request, page, onDone }: FormProps) {
  const write = useAidCostOverride()
  const { row } = request
  const set = row.cost_override ?? null
  const [cost, setCost] = useState(set === null ? '' : String(set.amount))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, attempt } = useSubmit()
  const typed = parseMoneyInput(cost)
  const price = rulesPrice(request)
  const was =
    set !== null
      ? `${formatMoney(set.amount)} (set by staff)`
      : price === null
        ? null
        : `${price.amount}, ${price.source}`
  const perPersonHeadcount = reason === 'headcount' && row.rules_cost_from === 'per_person'

  const submit = () =>
    attempt(() => {
      if (typed.kind === 'empty') return 'Type the cost'
      if (typed.kind === 'invalid') return 'Type the cost in dollars, like 1275 or 1275.50'
      if (reason === '') return 'Choose a reason'
      if (note.trim() === '') return NOTE_REQUIRED
      return () =>
        write
          .mutateAsync({
            requestId: row.request_id,
            body: { amount: typed.amount, reason_code: reason, note: note.trim() },
          })
          .then(onDone)
    })

  const placeholder =
    row.rules_cost === null || row.rules_cost === undefined
      ? undefined
      : String(Math.round(row.rules_cost))
  return (
    <FormShell
      head="Cost"
      submitLabel="Set the Cost"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
      side={
        <>
          {typed.kind === 'ok' ? (
            <div data-testid="set-cost-lead" className={HH_EDITOR_SIDE_LEAD}>
              <b>{formatMoney(typed.amount)}</b> instead of {was ?? 'no price'}
            </div>
          ) : (
            <div className={HH_NOTE}>Type the cost to see it here</div>
          )}
          <div className={HH_EDITOR_SIDE_NOTE}>
            Rounds not yet posted are worked out again on this cost.
          </div>
          {anyPosted(request) && <div className={HH_EDITOR_SIDE_NOTE}>{POSTED_WARNING}</div>}
          {perPersonHeadcount && (
            <div className={HH_EDITOR_SIDE_NOTE}>
              To change who is counted, use Number of People… instead: the cost then follows the
              per-person rates.
            </div>
          )}
        </>
      }
    >
      <label className={HH_EDITOR_LABEL}>
        Cost
        <span className="inline-flex items-center gap-1.5 font-normal">
          $
          <input
            aria-label="Cost"
            type="text"
            inputMode="decimal"
            value={cost}
            placeholder={placeholder}
            onChange={(event) => setCost(event.target.value)}
            className={HH_EDITOR_MONEY}
          />
        </span>
      </label>
      <label className={HH_EDITOR_LABEL}>
        Reason
        <select
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={`${HH_EDITOR_FIELD} self-start`}
        >
          <option value="">Choose a reason…</option>
          {costReasonOptions(page.override_reasons ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className={HH_EDITOR_LABEL}>
        Note
        <input
          aria-label="Note"
          type="text"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          className={HH_EDITOR_TEXT}
        />
      </label>
    </FormShell>
  )
}

/** "Clear" on a cost staff set: why, and what the cost goes back to. */
export function ClearCostForm({ request, onDone }: FormProps) {
  const write = useAidCostOverride()
  const [note, setNote] = useState('')
  const { busy, error, attempt } = useSubmit()
  const price = rulesPrice(request)

  const submit = () =>
    attempt(() => {
      if (note.trim() === '') return NOTE_REQUIRED
      return () =>
        write
          .mutateAsync({
            requestId: request.row.request_id,
            body: { amount: null, note: note.trim() },
          })
          .then(onDone)
    })

  return (
    <FormShell
      head="Clearing the cost"
      submitLabel="Clear the Cost"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onDone}
      side={
        <>
          <div data-testid="clear-cost-lead" className={HH_EDITOR_SIDE_LEAD}>
            {price === null ? (
              'Back to no price yet'
            ) : (
              <>
                Back to <b>{price.amount}</b>, {price.source}
              </>
            )}
          </div>
          {anyPosted(request) && <div className={HH_EDITOR_SIDE_NOTE}>{POSTED_WARNING}</div>}
        </>
      }
    >
      <label className={HH_EDITOR_LABEL}>
        Why clear
        <input
          aria-label="Why clear"
          type="text"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          className={HH_EDITOR_TEXT}
        />
      </label>
    </FormShell>
  )
}
