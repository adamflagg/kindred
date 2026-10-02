import { useRef, useState } from 'react'

import { useAidTickAccepted, useAidTickPosted } from '../../../hooks/camperships/useAidWrites'
import { AidWriteError } from '../../../services/camperships/aidApi'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { Modal } from '../../ui/Modal'
import { formatMoney } from '../kit/money'
import { doneWords, MAX_TICK_ROWS, tickWords, wroteNothing, type TickPlan } from './ticks'

const SHOWN = 12

/**
 * The confirmation a tick opens, computed at the click (§4.10; D41; Decision 17): the count, the
 * families and, for Posted, the total it locks. What you confirm is what's written: one operation,
 * one line in History (the server's log). The plan is frozen at the click; the server re-checks every
 * decided amount and refuses the lot if one moved.
 */
export function BulkConfirmDialog({
  plan,
  year,
  onClose,
  onDone,
}: {
  plan: TickPlan | null
  year: number
  onClose: () => void
  onDone: (words: string) => void
}) {
  const posted = useAidTickPosted()
  const accepted = useAidTickAccepted()
  const [error, setError] = useState<AidWriteError | null>(null)
  // A second click lands before the first one's pending state renders.
  const inFlight = useRef(false)
  const [sending, setSending] = useState(false)
  if (plan === null) return null

  const busy = sending || posted.isPending || accepted.isPending
  const tooMany = plan.rows.length > MAX_TICK_ROWS
  const labelOf = (requestId: string) =>
    plan.rows.find((r) => r.requestId === requestId)?.label ?? requestId
  // Closing mid-write would let this write's result close whatever the person opens next.
  const close = () => {
    if (inFlight.current) return
    setError(null)
    onClose()
  }
  const confirm = async () => {
    if (inFlight.current || tooMany) return
    inFlight.current = true
    setSending(true)
    setError(null)
    try {
      const out =
        plan.action === 'posted'
          ? await posted.mutateAsync({
              year,
              body: {
                rows: plan.rows.map((r) => ({
                  request_id: r.requestId,
                  round: r.round,
                  amount: r.amount ?? 0,
                })),
              },
            })
          : await accepted.mutateAsync({
              year,
              body: {
                rows: plan.rows.map((r) => ({ request_id: r.requestId, round: r.round })),
                accepted: true,
              },
            })
      inFlight.current = false
      setSending(false)
      onDone(doneWords(plan.action, out))
    } catch (caught) {
      inFlight.current = false
      setSending(false)
      setError(
        caught instanceof AidWriteError
          ? caught
          : new AidWriteError(caught instanceof Error ? caught.message : "Couldn't save", 0)
      )
    }
  }

  return (
    <Modal
      isOpen
      onClose={close}
      title={plan.action === 'posted' ? 'Tick Posted' : 'Tick Accepted'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={busy || plan.rows.length === 0 || tooMany}
            onClick={() => void confirm()}
          >
            Confirm
          </button>
        </div>
      }
    >
      <div className="space-y-2 text-sm">
        <p className="font-medium">{tickWords(plan)}</p>
        {plan.action === 'posted' && (
          <p className="text-muted-foreground text-xs">
            Tick what is already entered in CampMinder: posting there is the offer, and each tick
            locks its amount. The total is an estimate; the result shows what the server locked.
          </p>
        )}
        <ul className="text-muted-foreground text-xs">
          {plan.rows.slice(0, SHOWN).map((r) => (
            <li key={`${r.requestId}:${String(r.round)}`}>
              {r.label} · Round {r.round}
              {r.amount !== null ? ` · ${formatMoney(r.amount)}` : ''}
            </li>
          ))}
          {plan.rows.length > SHOWN && <li>and {plan.rows.length - SHOWN} more</li>}
        </ul>
        {plan.skipped.length > 0 && (
          <p className={AMBER_NOTE}>Nothing to tick on {plan.skipped.join(', ')}: left out.</p>
        )}
        {tooMany && (
          <p className={AMBER_NOTE}>
            A tick is all or nothing, and takes at most {MAX_TICK_ROWS} requests: select fewer.
          </p>
        )}
        {error && (
          <div className={`${AMBER_NOTE} space-y-1`}>
            <p>{error.message}</p>
            {error.rows.length > 0 && (
              <ul>
                {error.rows.map((r) => (
                  // One text node, so the line reads (and is found) whole.
                  <li key={`${r.request_id}:${String(r.round)}`}>
                    {`${labelOf(r.request_id)} R${String(r.round)}: now ${formatMoney(r.decided_now)}, you confirmed ${formatMoney(r.confirmed)}`}
                  </li>
                ))}
              </ul>
            )}
            {wroteNothing(error.status) ? (
              <p>
                Nothing was ticked.
                {error.rows.length > 0 &&
                  ' The grid has refreshed: close this and tick again to confirm the new amounts.'}
              </p>
            ) : (
              <p>
                We can&apos;t tell whether this was saved. The grid has refreshed: check it before
                ticking again.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
