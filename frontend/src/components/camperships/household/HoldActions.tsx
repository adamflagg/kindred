import { useState } from 'react'

import { useAidHoldRelease, useAidManualHold } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { ACTION_LINK, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { formatShortDate } from '../kit/dates'
import { codeWords } from '../requests/attention'
import { fixLink, UNRELEASABLE_CODES } from './holds'
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
  const fix = fixLink(code, requestId)
  // The server's own severity: only a hold stops the award, so only a hold has anything to release.
  const releasable =
    !UNRELEASABLE_CODES.has(code) &&
    request.row.holds.some((hold) => hold.code === code && hold.severity === 'hold')

  if (open) {
    return code === 'manual_hold' ? (
      <ReasonForm
        label="Why lift the hold"
        submitLabel="Lift the hold"
        onSubmit={(note) =>
          manual.mutateAsync({ requestId, body: { held: false, note } }).then(close)
        }
        onCancel={close}
      />
    ) : (
      <ReasonForm
        label="Release note"
        submitLabel="Release the hold"
        onSubmit={(note) =>
          release.mutateAsync({ requestId, body: { code, released: true, note } }).then(close)
        }
        onCancel={close}
      />
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fix !== null && (
        <a href={fix.href} className={ACTION_LINK}>
          {fix.label}
        </a>
      )}
      {code === 'manual_hold' && (
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(true)}>
          Lift…
        </button>
      )}
      {releasable && (
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen(true)}>
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
  if (request.row.released_holds.length === 0) return null
  return (
    <div className="basis-full space-y-1 text-xs">
      {request.row.released_holds.map((held) => (
        <div key={held.code} className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {`${codeWords(held.code)} released ${formatShortDate(held.released_at)} by ${held.released_by}: ${held.note}`}
          </span>
          {putting === held.code ? (
            <ReasonForm
              label="Why put it back"
              submitLabel="Put the hold back"
              onSubmit={(note) =>
                release
                  .mutateAsync({ requestId, body: { code: held.code, released: false, note } })
                  .then(() => setPutting(null))
              }
              onCancel={() => setPutting(null)}
            />
          ) : (
            <button type="button" className={ACTION_LINK} onClick={() => setPutting(held.code)}>
              Put back…
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
