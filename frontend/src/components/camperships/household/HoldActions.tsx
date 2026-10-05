import { useState } from 'react'

import { useAidHoldRelease, useAidManualHold } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import { codeWords } from '../requests/attention'
import { isLiveRequest } from '../requests/gridEditor'
import { cardEdits } from './cardEdits'
import { fixLink, fixWords, UNRELEASABLE_CODES } from './holds'
import { HH_BUTTON, HH_LINK, HH_NOTE } from './householdStyles'
import { ReasonForm } from './ReasonForm'

/**
 * A hold banner's actions (§6.3 item 3; main spec §10.5; Decision 25): the fix for a hold that
 * clears by fixing its cause, "Release…" with a note for the rest, and "Lift…" for the manual hold.
 */
export function HoldActions({ request, code }: { request: ApiAidHouseholdRequest; code: string }) {
  const release = useAidHoldRelease()
  const manual = useAidManualHold()
  const [open, setOpen] = useState(false)
  const requestId = request.row.request_id
  const close = () => setOpen(false)
  const link = fixLink(code, requestId)
  // B26: the award is edited in the card's own money editors; with none offered, the words alone.
  const fix = code === 'award_above_cost' && cardEdits(request.row).length === 0 ? null : link
  const words = fixWords(code)
  // The server's own severity: only a hold stops the award, so only a hold has anything to release.
  const live = isLiveRequest(request.row)
  const releasable =
    live &&
    !UNRELEASABLE_CODES.has(code) &&
    request.row.holds.some((hold) => hold.code === code && hold.severity === 'hold')

  if (open) {
    return code === 'manual_hold' ? (
      <ReasonForm
        head="Lifting the hold"
        label="Why lift the hold"
        submitLabel="Lift the Hold"
        onSubmit={(note) =>
          manual.mutateAsync({ requestId, body: { held: false, note } }).then(close)
        }
        onCancel={close}
      />
    ) : (
      <ReasonForm
        head="Releasing the hold"
        label="Release note"
        submitLabel="Release the Hold"
        onSubmit={(note) =>
          release.mutateAsync({ requestId, body: { code, released: true, note } }).then(close)
        }
        onCancel={close}
      />
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {words !== null && <span className={HH_NOTE}>{words}</span>}
      {fix !== null && (
        <a href={fix.href} className={HH_LINK}>
          {fix.label}
        </a>
      )}
      {live && code === 'manual_hold' && (
        <button type="button" className={HH_BUTTON} onClick={() => setOpen(true)}>
          Lift…
        </button>
      )}
      {releasable && (
        <button type="button" className={HH_BUTTON} onClick={() => setOpen(true)}>
          Release…
        </button>
      )}
    </div>
  )
}

/** Holds released on this request, with who and when, each able to go back on with a note. */
export function ReleasedHolds({ request }: { request: ApiAidHouseholdRequest }) {
  const release = useAidHoldRelease()
  const [putting, setPutting] = useState<string | null>(null)
  const requestId = request.row.request_id
  // The server refuses a hold change on a withdrawn or duplicate request: no button to put one back.
  const live = isLiveRequest(request.row)
  if (request.row.released_holds.length === 0) return null
  return (
    <div className="basis-full space-y-1 text-[12.5px]">
      {request.row.released_holds.map((held) => (
        <div key={held.code} className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {`${codeWords(held.code)} released ${formatShortDate(held.released_at)} by ${held.released_by}: ${held.note}`}
          </span>
          {putting === held.code ? (
            <ReasonForm
              head="Putting the hold back"
              label="Why put it back"
              submitLabel="Put the Hold Back"
              onSubmit={(note) =>
                release
                  .mutateAsync({ requestId, body: { code: held.code, released: false, note } })
                  .then(() => setPutting(null))
              }
              onCancel={() => setPutting(null)}
            />
          ) : (
            live && (
              <button type="button" className={HH_LINK} onClick={() => setPutting(held.code)}>
                Put Back…
              </button>
            )
          )}
        </div>
      ))}
    </div>
  )
}
