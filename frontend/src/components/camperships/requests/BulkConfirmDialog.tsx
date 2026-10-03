import { useState } from 'react'

import { useAidTickAccepted } from '../../../hooks/camperships/useAidWrites'
import { AidWriteError } from '../../../services/camperships/aidApi'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { Modal } from '../../ui/Modal'
import type { ApiAidWriteOut } from '../../../types/api-types'
import { doneWords, MAX_TICK_ROWS, tickWords, wroteNothing, type TickPlan } from './ticks'

const NAMED = 10

/** The first ten names, then how many more (a select-all can leave hundreds out). */
const namesOf = (names: readonly string[]) =>
  names.length > NAMED
    ? `${names.slice(0, NAMED).join(', ')} and ${String(names.length - NAMED)} more`
    : names.join(', ')

/**
 * The confirmation a tick opens, computed at the click (§4.10; D41; Decision 17): the count, the
 * families. What you confirm is what's written: one operation,
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
  /** The result's words, and what the server said it did (the page lists the rows by that). */
  onDone: (words: string, out: ApiAidWriteOut) => void
}) {
  const accepted = useAidTickAccepted()
  const [error, setError] = useState<AidWriteError | null>(null)
  // `sending` also covers the gap before the mutation reports pending.
  const [sending, setSending] = useState(false)
  if (plan === null) return null

  const busy = sending || accepted.isPending
  const tooMany = plan.rows.length > MAX_TICK_ROWS
  // The server names requests by id; staff read names.
  const named = (text: string) =>
    plan.rows.reduce((words, r) => words.replaceAll(r.requestId, r.label), text)
  // Closing mid-write would let this write's result close whatever the person opens next.
  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }
  const confirm = async () => {
    if (busy || tooMany) return
    setSending(true)
    setError(null)
    try {
      const out = await accepted.mutateAsync({
        year,
        body: {
          rows: plan.rows.map((r) => ({ request_id: r.requestId, round: r.round })),
          accepted: true,
        },
      })
      setSending(false)
      onDone(doneWords(out), out)
    } catch (caught) {
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
      closeDisabled={busy}
      title="Tick Accepted"
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
            {busy ? 'Ticking…' : 'Confirm'}
          </button>
        </div>
      }
    >
      <div className="space-y-2 text-sm">
        <p className="font-medium">
          {plan.rows.length === 0 ? 'Nothing to tick' : tickWords(plan)}
        </p>
        <ul className="text-muted-foreground max-h-48 overflow-y-auto text-xs">
          {plan.rows.map((r) => (
            <li key={`${r.requestId}:${String(r.round)}`}>
              {r.label} · Round {r.round}
              {r.hidden ? ' (hidden by the search or filters)' : ''}
            </li>
          ))}
        </ul>
        {plan.skipped.length > 0 && (
          <p className={AMBER_NOTE}>Nothing to tick on {namesOf(plan.skipped)}: left out.</p>
        )}
        {tooMany && (
          <p className={AMBER_NOTE}>
            A tick is all or nothing, and takes at most {MAX_TICK_ROWS} requests: select fewer.
          </p>
        )}
        {error && (
          <div className={`${AMBER_NOTE} space-y-1`}>
            <p>{named(error.message)}</p>
            {wroteNothing(error.status) ? (
              <p>Nothing was ticked.</p>
            ) : (
              <p>
                We can&apos;t tell whether this was saved. Check the grid, or confirm again: ticking
                again is safe, and a round already ticked is left as it is.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
