import { useState } from 'react'

import {
  useAidRound3Decision,
  useAidTickAccepted,
  useAidTickPosted,
  useAidUndoPosted,
} from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { cancelledInKindred } from '../requests/ticks'
import type { RoundLine } from './householdModel'
import { ReasonForm } from './ReasonForm'

const MUTED = 'text-muted-foreground text-xs'
const asRound = (n: number): 1 | 2 | 3 | null => (n === 1 || n === 2 || n === 3 ? n : null)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn't save")

/**
 * What the undo form says first. "A posted amount stands" is true only while the tick stands: on a
 * reversed round, or one whose posted amount differs from today's decided figure, undoing re-prices
 * it, so that clause goes and (owner-approved wording) the figure it returns to is named.
 */
function undoHint(line: RoundLine): string {
  const mistake = 'For a tick made by mistake.'
  if (line.decided !== null && line.amount !== null && line.decided !== line.amount) {
    return `${mistake} Undoing returns Round ${String(line.round)} to today's ${formatMoney(line.decided)}; ticking Posted again locks that.`
  }
  if (line.clawedBack || line.wouldChangeBy !== null) return mistake
  return `${mistake} A posted amount stands: a later change to the award never lowers it.`
}

/**
 * A round's checklist on the household page (§5.2, §6.3; D47, D51; Decision 22). Posted is ticked by
 * "Mark posted" (the next action); here its box unticks, with the reason the undo needs. Accepted
 * ticks a posted round only.
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
  const postedText = `Posted${line.posted && line.postedOn ? ` ${formatShortDate(line.postedOn)}` : ''}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={line.posted}
            disabled={!line.posted || editing}
            onChange={() => setUndoing(true)}
          />
          {postedText}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={line.accepted}
            // The server refuses ticking Accepted on a Kindred cancellation, never unticking it.
            disabled={
              !line.posted ||
              accept.isPending ||
              editing ||
              (cancelledInKindred(request.row) && !line.accepted)
            }
            onChange={(event) => {
              setError(null)
              accept.mutate(
                {
                  year,
                  body: {
                    rows: [{ request_id: requestId, round }],
                    accepted: event.target.checked,
                  },
                },
                { onError: (caught) => setError(messageOf(caught)) }
              )
            }}
          />
          Accepted
        </label>
      </div>
      {undoing && (
        // Owner ruling 2026-10-01 S1 Q1: once posted, an amount stands. That sentence is true only
        // while the tick stands: on a reversed round, or one whose posted amount differs from today's
        // decided one, undoing re-prices it, so only the first clause is honest (lead ruling, fix round 1).
        <span className="text-muted-foreground text-xs">{undoHint(line)}</span>
      )}
      {undoing && (
        <ReasonForm
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
 * A round's next action (decision-panel.html; D51, D79; Decision 22): "Mark posted · locks $X" once
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
  /** This card has a money editor open: Mark posted and the decision wait for it. */
  editing?: boolean | undefined
}) {
  const posted = useAidTickPosted()
  const decide = useAidRound3Decision()
  const [deciding, setDeciding] = useState<'approve' | 'refuse' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const round = asRound(line.round)
  const requestId = request.row.request_id
  // A refusal belongs to the line it was made on: a changed status or decided amount clears it.
  // Reset during render (React's documented pattern), not in an effect: no extra render pass.
  const lineKey = `${line.status}:${String(line.decided)}`
  const [seenKey, setSeenKey] = useState(lineKey)
  if (seenKey !== lineKey) {
    setSeenKey(lineKey)
    setError(null)
  }

  const cancelled = cancelledInKindred(request.row)
  if (line.status === 'needs_offer' && line.decided !== null && round !== null) {
    const amount = line.decided
    // The server posts rounds in order: a later round waits on the first one not yet posted.
    const blocking = request.row.rounds
      .filter((r) => r.round < line.round && r.status !== 'posted')
      .sort((a, b) => a.round - b.round)[0]
    if (blocking !== undefined) {
      return (
        <span className="text-muted-foreground text-xs">{`after Round ${String(blocking.round)} is posted`}</span>
      )
    }
    if (cancelled) return <span className={MUTED}>Cancelled in Kindred: reopen it first</span>
    if (editing) return <span className={MUTED}>save or close the edit first</span>
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={posted.isPending}
          onClick={() => {
            setError(null)
            posted.mutate(
              { year, body: { rows: [{ request_id: requestId, round, amount }] } },
              { onError: (caught) => setError(messageOf(caught)) }
            )
          }}
        >
          {`Mark posted · locks ${formatMoney(amount)}`}
        </button>
        {error !== null && <span className={AMBER_NOTE}>{error}</span>}
      </div>
    )
  }
  if (line.status === 'pending_approval' && canApprove) {
    if (cancelled) return <span className={MUTED}>Cancelled in Kindred: reopen it first</span>
    if (editing) return <span className={MUTED}>save or close the edit first</span>
    if (deciding === null) {
      return (
        <div className="flex gap-2">
          <button type="button" className={BUTTON_PRIMARY} onClick={() => setDeciding('approve')}>
            Approve…
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setDeciding('refuse')}>
            Refuse…
          </button>
        </div>
      )
    }
    const approve = deciding === 'approve'
    return (
      <ReasonForm
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
    return (
      <span className="text-muted-foreground text-xs">
        waits for finance&apos;s approval on Today
      </span>
    )
  }
  return null
}
