import { useState } from 'react'

import {
  useAidRound3Decision,
  useAidTickAccepted,
  useAidTickPosted,
  useAidUndoPosted,
} from '../../../hooks/camperships/useAidWrites'
import { AidWriteError } from '../../../services/camperships/aidApi'
import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { cancelledInKindred } from '../requests/ticks'
import type { RoundLine } from './householdModel'
import {
  HH_AMBER_NOTE as AMBER_NOTE,
  HH_BUTTON,
  HH_BUTTON_PRIMARY,
  HH_NOTE as MUTED,
  HH_TICK,
  HH_TICK_BOX,
} from './householdStyles'
import { ReasonForm } from './ReasonForm'

/**
 * B22 (ruled 10-04 late): since D162 the overnight tick never re-marks a round unmarked by hand, so
 * the undo says where the round goes instead (the server's UNTICKED_LABELS "undone").
 */
const UNDO_WARNING =
  'The overnight sync won\'t mark it posted again: it will show in Not reconciled as "Unmarked by hand".'

/**
 * A checklist box (D6): the real checkbox stays the control, drawn as the mock's 14px forest box with
 * a white ✓; the date beside its label is muted.
 */
function TickBox({
  label,
  date,
  checked,
  disabled,
  onChange,
}: {
  label: string
  date?: string | null | undefined
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={HH_TICK}>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={HH_TICK_BOX}
        />
        {checked && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] leading-none text-white"
          >
            ✓
          </span>
        )}
      </span>
      {label}
      {date ? <span className="text-muted-foreground">{` ${date}`}</span> : null}
    </label>
  )
}
const asRound = (n: number): 1 | 2 | 3 | null => (n === 1 || n === 2 || n === 3 ? n : null)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn't save")

/**
 * What the undo form says first (B22, owner sitting B: no "a posted amount stands" sentence, and no
 * shortened variant for rules-moved rounds). Where today's decided figure differs from the posted
 * one, undoing re-prices the round, so the figure it returns to is named (owner-approved wording).
 */
function undoHint(line: RoundLine): string {
  const mistake = 'For a tick made by mistake.'
  if (line.decided !== null && line.amount !== null && line.decided !== line.amount) {
    return `${mistake} Undoing returns Round ${String(line.round)} to today's ${formatMoney(line.decided)}; marking it posted again locks that.`
  }
  return mistake
}

/**
 * A round's checklist on the household page (§5.2, §6.3; D47, D51; Decision 22). Posted is ticked by
 * "Mark Posted" (the next action); here its box unticks, with the reason the undo needs. Accepted
 * ticks a posted round or a C1 round (`cm_pending`, as the grid's `acceptedTarget` offers it), never
 * a reversed one.
 */
export function RoundChecklist({
  request,
  line,
  year,
  editing = false,
}: {
  request: ApiAidHouseholdRequest
  line: RoundLine
  year: number
  /** This card has a money editor open: the round's writes wait for it (the tick would lock its figure). */
  editing?: boolean | undefined
}) {
  const undo = useAidUndoPosted()
  const accept = useAidTickAccepted()
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const round = asRound(line.round)
  const requestId = request.row.request_id
  if (round === null) return null
  const noAcceptOnReversed = line.clawedBack && !line.accepted
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <TickBox
          label="Posted"
          date={line.posted && line.postedOn ? formatShortDate(line.postedOn) : null}
          checked={line.posted}
          disabled={!line.posted || editing}
          onChange={() => setUndoing(true)}
        />
        <TickBox
          label="Accepted"
          checked={line.accepted}
          // The server refuses ticking Accepted on a Kindred cancellation, never unticking it. A
          // reversed round is the same: the grid never offers it (ticks.ts), unticking stays open.
          disabled={
            !(line.posted || line.cmPending) ||
            accept.isPending ||
            editing ||
            ((cancelledInKindred(request.row) || line.clawedBack) && !line.accepted)
          }
          onChange={(checked) => {
            setError(null)
            accept.mutate(
              {
                year,
                body: {
                  rows: [{ request_id: requestId, round }],
                  accepted: checked,
                },
              },
              { onError: (caught) => setError(messageOf(caught)) }
            )
          }}
        />
        {noAcceptOnReversed && <span className={MUTED}>Reversed: nothing to accept</span>}
      </div>
      {undoing && (
        <ReasonForm
          head={`Undoing Posted · Round ${String(line.round)}`}
          hint={
            <>
              <span className="block">{undoHint(line)}</span>
              <span className="block">{UNDO_WARNING}</span>
            </>
          }
          label="Why undo Posted"
          submitLabel="Undo Posted"
          onSubmit={(reason) =>
            undo
              .mutateAsync({ year, body: { request_id: requestId, round, reason } })
              .then(() => setUndoing(false))
          }
          onCancel={() => setUndoing(false)}
        />
      )}
      {error !== null && <span className={AMBER_NOTE}>{error}</span>}
    </div>
  )
}

/**
 * A round's next action (decision-panel.html; D51, D79; Decision 22): "Mark Posted · locks $X" once
 * the award is entered in CampMinder (the label is the confirmation); finance's decision on a Round 3
 * waiting on it, with a note.
 */
export function RoundNextAction({
  request,
  line,
  year,
  canApprove,
  editing = false,
}: {
  request: ApiAidHouseholdRequest
  line: RoundLine
  year: number
  canApprove: boolean
  /** This card has a money editor open: Mark Posted and the decision wait for it. */
  editing?: boolean | undefined
}) {
  const posted = useAidTickPosted()
  const decide = useAidRound3Decision()
  const [deciding, setDeciding] = useState<'approve' | 'refuse' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A withheld round's decided_now is what the tick WOULD lock, so refreshing and ticking again can
  // only be refused again: a 409 that names a different amount offers it (#2981).
  const [offer, setOffer] = useState<number | null>(null)
  const round = asRound(line.round)
  const requestId = request.row.request_id
  // A refusal belongs to the line it was made on: a changed status or decided amount clears it.
  // Reset during render (React's documented pattern), not in an effect: no extra render pass.
  const lineKey = `${line.status}:${String(line.decided)}`
  const [seenKey, setSeenKey] = useState(lineKey)
  if (seenKey !== lineKey) {
    setSeenKey(lineKey)
    setError(null)
    setOffer(null)
  }

  const cancelled = cancelledInKindred(request.row)
  if (line.status === 'needs_offer' && line.decided !== null && round !== null) {
    const amount = line.decided
    // D162 keeps the hand tick here, so an ordinary needs-offer round shows it. It hides where a
    // tick is already on its way (C1/V1: `cm_pending`, shown as the grid does) or where the server
    // says a hand tick is no answer (`unticked[]` for this round with `mark_posted` false).
    const thisRound = request.row.rounds.find((r) => r.round === line.round)
    if (thisRound?.cm_pending === true) return null
    if ((request.row.unticked ?? []).some((u) => u.round === line.round && !u.mark_posted)) {
      return null
    }
    // The server posts rounds in order: a later round waits on the first one not yet posted.
    const blocking = request.row.rounds
      .filter((r) => r.round < line.round && r.status !== 'posted')
      .sort((a, b) => a.round - b.round)[0]
    if (blocking !== undefined) {
      return <span className={MUTED}>{`after Round ${String(blocking.round)} is posted`}</span>
    }
    if (cancelled) return <span className={MUTED}>Cancelled in Kindred: reopen it first</span>
    if (editing) return <span className={MUTED}>save or close the edit first</span>
    const send = (at: number) => {
      setError(null)
      setOffer(null)
      posted.mutate(
        { year, body: { rows: [{ request_id: requestId, round, amount: at }] } },
        {
          onError: (caught) => {
            setError(messageOf(caught))
            if (caught instanceof AidWriteError && caught.status === 409) {
              const moved = caught.rows.find((r) => r.request_id === requestId && r.round === round)
              if (moved?.decided_now != null && moved.decided_now !== at)
                setOffer(moved.decided_now)
            }
          },
        }
      )
    }
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className={HH_BUTTON_PRIMARY}
          disabled={posted.isPending}
          onClick={() => send(amount)}
        >
          {`Mark Posted · locks ${formatMoney(amount)}`}
        </button>
        {error !== null && <span className={AMBER_NOTE}>{error}</span>}
        {offer !== null && (
          <button
            type="button"
            className={HH_BUTTON}
            disabled={posted.isPending}
            onClick={() => send(offer)}
          >
            {`Mark Posted at ${formatMoney(offer)}`}
          </button>
        )}
      </div>
    )
  }
  if (line.status === 'pending_approval' && canApprove) {
    if (cancelled) return <span className={MUTED}>Cancelled in Kindred: reopen it first</span>
    if (editing) return <span className={MUTED}>save or close the edit first</span>
    if (deciding === null) {
      return (
        <div className="flex gap-2">
          <button
            type="button"
            className={HH_BUTTON_PRIMARY}
            onClick={() => setDeciding('approve')}
          >
            Approve…
          </button>
          <button type="button" className={HH_BUTTON} onClick={() => setDeciding('refuse')}>
            Refuse…
          </button>
        </div>
      )
    }
    const approve = deciding === 'approve'
    return (
      <ReasonForm
        head={`${approve ? 'Approving' : 'Refusing'} Round ${String(line.round)}`}
        label={approve ? 'Approval note' : 'Why refuse'}
        submitLabel={approve ? 'Approve' : 'Refuse'}
        onSubmit={(note) =>
          decide.mutateAsync({ requestId, body: { approve, note } }).then(() => setDeciding(null))
        }
        onCancel={() => setDeciding(null)}
      />
    )
  }
  if (line.status === 'pending_approval') {
    return <span className={MUTED}>Pending finance approval</span>
  }
  return null
}
