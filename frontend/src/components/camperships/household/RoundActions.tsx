import { useRef, useState } from 'react'

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
import type { RoundLine } from './householdModel'
import { ReasonForm } from './ReasonForm'

const asRound = (n: number): 1 | 2 | 3 | null => (n === 1 || n === 2 || n === 3 ? n : null)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn't save")

/**
 * A round's checklist on the household page (§5.2, §6.3; D47, D51; Decision 22). Posted is ticked by
 * "Mark posted" (the next action); here its box unticks, with the reason the undo needs. Accepted
 * ticks a posted round only.
 */
export function RoundChecklist({
  request,
  line,
  year,
}: {
  request: ApiAidHouseholdRequest
  line: RoundLine
  year: number
}) {
  const undo = useAidUndoPosted()
  const accept = useAidTickAccepted()
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest tick may show an error: a superseded write failing late must not overwrite it.
  const latest = useRef(0)
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
            disabled={!line.posted}
            onChange={() => setUndoing(true)}
          />
          {postedText}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={line.accepted}
            disabled={!line.posted || accept.isPending}
            onChange={(event) => {
              setError(null)
              const mine = ++latest.current
              accept.mutate(
                {
                  year,
                  body: {
                    rows: [{ request_id: requestId, round }],
                    accepted: event.target.checked,
                  },
                },
                {
                  onError: (caught) => {
                    if (mine === latest.current) setError(messageOf(caught))
                  },
                }
              )
            }}
          />
          Accepted
        </label>
      </div>
      {undoing && (
        // Owner ruling 2026-10-01 S1 Q1: once posted, an amount stands.
        <span className="text-muted-foreground text-xs">
          For a tick made by mistake. A posted amount stands: a later change to the award never
          lowers it.
        </span>
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
}: {
  request: ApiAidHouseholdRequest
  line: RoundLine
  year: number
  canApprove: boolean
}) {
  const posted = useAidTickPosted()
  const decide = useAidRound3Decision()
  const [deciding, setDeciding] = useState<'approve' | 'refuse' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const round = asRound(line.round)
  const requestId = request.row.request_id

  if (line.status === 'needs_offer' && line.decided !== null && round !== null) {
    const amount = line.decided
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={posted.isPending}
          onClick={() => {
            setError(null)
            const mine = ++latest.current
            posted.mutate(
              { year, body: { rows: [{ request_id: requestId, round, amount }] } },
              {
                onError: (caught) => {
                  if (mine === latest.current) setError(messageOf(caught))
                },
              }
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
