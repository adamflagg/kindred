import { useAidDuplicate } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { twinName, type DuplicatePair } from './duplicatePair'
import { ReasonForm } from './ReasonForm'

/**
 * The swap of a duplicate pair (#3024, owner 2026-10-05): keep the PENDING request and close the
 * ACTIVE one it waits on, in one write, `POST /requests/{active}/duplicate {duplicate_of: pending}`.
 * Asked from the pending card as "Keep This Request…" (`keepsThis`) or from the active card as "Keep
 * the Other Request…". A reason, as every duplicate write. The server refuses it while the active
 * request has a Posted round or a recorded decision (the strict rule, owner-approved): its own words
 * show in the box, with what was typed kept; nothing is pre-filtered here.
 */
export function PairKeepForm({
  request,
  pair,
  keepsThis,
  onDone,
}: {
  request: ApiAidHouseholdRequest
  pair: DuplicatePair
  keepsThis: boolean
  onDone: () => void
}) {
  const mark = useAidDuplicate()
  const id = request.row.request_id
  // Keeping this one: this is the pending one and the other the active. Keeping the other: reversed.
  const active = keepsThis ? pair.otherId : id
  const pending = keepsThis ? id : pair.otherId
  // Owner call 10-05 late: the other request by camper · session (+ its household's label when it is
  // on another page), never its raw id: see twinName.
  const twin = twinName(pair, request)
  return (
    <ReasonForm
      head={keepsThis ? 'Keeping this request' : 'Keeping the other request'}
      label="Reason"
      submitLabel={keepsThis ? 'Keep This Request' : 'Keep the Other Request'}
      hint={
        keepsThis
          ? `Marks the other request as the duplicate and keeps this one: ${twin}`
          : `Marks this request as the duplicate and keeps the other: ${twin}`
      }
      onSubmit={(note) =>
        mark
          .mutateAsync({ requestId: active, body: { duplicate_of: pending, reason: note } })
          .then(onDone)
      }
      onCancel={onDone}
    />
  )
}
