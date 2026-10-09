import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidPlaceGrants } from '../../../hooks/camperships/useAidGrantWrites'
import { queryKeys } from '../../../utils/queryKeys'
import { Modal } from '../../ui/Modal'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_SMALL } from '../kit/csType'
import { refusalWords } from '../money/refusal'
import { grantLineWords, MAX_GRANT_PLACEMENTS, planWords, type GrantPlan } from './needsModel'
import { placedGrantWords, placementFor, stillNeedsCamper, suggestionCell } from './placeModel'

/**
 * Confirm single, exact suggestions together (S3-6; §4.10): every line listed (those the search
 * hides marked), all or nothing, one operation. `plan` is derived by the caller from the CURRENT
 * read while the dialog is open, so lines placed since the click show as gone. Before sending it reads
 * the lines again (P-9): if any was placed meanwhile it sends nothing and refreshes the list. No money
 * total: placing a camper locks nothing (number meaning).
 */
export function BulkGrantDialog({
  plan,
  year,
  sessions,
  onClose,
  onDone,
}: {
  plan: GrantPlan | null
  year: number
  /** Session names by id (useAidSessionNames), for the suggestion's "camper · session". */
  sessions: ReadonlyMap<number, string> | undefined
  onClose: () => void
  onDone: (words: string, placed: readonly number[]) => void
}) {
  const place = useAidPlaceGrants()
  const fresh = useFreshAidGrants()
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A second press while one is in flight is ignored.
  const inFlight = useRef(false)
  if (plan === null) return null
  const placements = plan.lines.flatMap(({ need }) =>
    need.suggestion === null ? [] : [placementFor(need, need.suggestion.person_cm_id)]
  )
  const tooMany = placements.length > MAX_GRANT_PLACEMENTS
  const close = () => {
    if (inFlight.current) return
    setProblem(null)
    onClose()
  }
  const confirm = async () => {
    if (inFlight.current || tooMany || placements.length === 0) return
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    try {
      const latest = await fresh()
      const moved = placements.filter((p) => !stillNeedsCamper(latest, p.transaction_cm_id)).length
      if (moved > 0) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.aidGrantsPrefix() })
        setProblem(
          `${String(moved)} ${moved === 1 ? 'line was' : 'lines were'} placed since the page loaded; nothing was written. The list is refreshed: check it and confirm again.`
        )
        return
      }
      const out = await place.mutateAsync({ year, body: { placements, note: '' } })
      onDone(
        placedGrantWords(out),
        placements.map((p) => p.transaction_cm_id)
      )
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const n = placements.length
  return (
    <Modal
      isOpen
      onClose={close}
      closeDisabled={busy}
      title={`Confirm ${String(n)} ${n === 1 ? 'suggestion' : 'suggestions'}`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={CS_BTN2} disabled={busy} onClick={close}>
            Back
          </button>
          <button
            type="button"
            className={CS_BTN}
            disabled={busy || tooMany || n === 0}
            onClick={() => void confirm()}
          >
            {busy ? 'Placing…' : `Confirm ${String(n)}`}
          </button>
        </div>
      }
    >
      <div className="space-y-2 text-sm">
        <p>{`Each line goes on its household's one applicant camper: ${planWords(plan)}.`}</p>
        <p className={CS_SMALL}>
          An unposted round re-prices with the grant; a posted round stands. All or nothing, one
          operation in History.
        </p>
        <ul className={`${CS_SMALL} max-h-48 overflow-y-auto`}>
          {plan.lines.map(({ need, hidden }) => (
            <li key={need.grant.transaction_cm_id}>
              {`${need.grant.family_name}: ${grantLineWords(need)} → ${suggestionCell(need, sessions)}`}
              {hidden ? ' (hidden by the search)' : ''}
            </li>
          ))}
        </ul>
        {plan.leftOut.length > 0 && (
          <p className={CS_AMBER_NOTE}>
            {`Left out, confirm one at a time: ${plan.leftOut.map((x) => x.grant.family_name).join(', ')} (not a single, exact suggestion).`}
          </p>
        )}
        {plan.gone > 0 && (
          <p className={CS_AMBER_NOTE}>
            {`${String(plan.gone)} ${plan.gone === 1 ? 'line is' : 'lines are'} no longer open and ${plan.gone === 1 ? 'was' : 'were'} left out.`}
          </p>
        )}
        {tooMany && (
          <p className={CS_AMBER_NOTE}>
            {`One confirm takes at most ${String(MAX_GRANT_PLACEMENTS)} lines.`}
          </p>
        )}
        {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
      </div>
    </Modal>
  )
}
