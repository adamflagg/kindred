import { useState } from 'react'

import { useAidWithdrawCommitment } from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidGrantRow } from '../../../types/api-types'
import { ReasonForm } from '../household/ReasonForm'
import type { AidView } from '../kit/asOf'
import { CS_BTN2, CS_PMETA } from '../kit/csType'
import { inStaffWords } from '../money/refusal'
import { CommitmentForm } from './CommitmentForm'
import { RegisterOpenRow } from './RegisterOpenRow'

/**
 * An open commitment's opened row, for casework (spec §8.2; D55): the Register's three panels with
 * Edit… and Withdraw… on the right, the form under them. A withdrawal needs a reason (logged); it
 * leaves the calculator's grants from now, and a posted amount stands.
 */
export function CommitmentRow({
  row,
  year,
  view,
  needsCamper,
  onDone,
}: {
  row: ApiAidGrantRow
  year: number
  view: AidView
  needsCamper: ReadonlySet<number>
  onDone: (words: string) => void
}) {
  const withdraw = useAidWithdrawCommitment()
  const [mode, setMode] = useState<'none' | 'edit' | 'withdraw'>('none')
  // R5-3: a finished save or withdraw closes its form, as GrantorPanel's `done` does; left open, a
  // second Save would re-read the person's own save and blame "someone" for it.
  const finish = (words: string) => {
    setMode('none')
    onDone(words)
  }
  const actions = (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={CS_BTN2}
          disabled={mode !== 'none'}
          onClick={() => setMode('edit')}
        >
          Edit…
        </button>
        <button
          type="button"
          className={CS_BTN2}
          disabled={mode !== 'none'}
          onClick={() => setMode('withdraw')}
        >
          Withdraw…
        </button>
      </div>
      <div className={CS_PMETA}>
        When its CampMinder line arrives, the next ledger sync matches it and it leaves
        &quot;committed&quot;.
      </div>
    </>
  )
  const editor =
    mode === 'edit' ? (
      <CommitmentForm year={year} row={row} onCancel={() => setMode('none')} onDone={finish} />
    ) : mode === 'withdraw' ? (
      <ReasonForm
        label="Why"
        head="Withdraw this commitment"
        submitLabel="Withdraw"
        hint="It leaves the Register and the calculator's grants from now; a posted amount stands. Kept in History."
        onCancel={() => setMode('none')}
        onSubmit={async (reason) => {
          await inStaffWords(
            withdraw.mutateAsync({ year, commitmentId: row.commitment_id, reason })
          )
          finish(
            "Commitment withdrawn, with your reason. It leaves the calculator's grants from now."
          )
        }}
      />
    ) : null
  return (
    <RegisterOpenRow
      row={row}
      view={view}
      needsCamper={needsCamper}
      actions={actions}
      editor={editor}
    />
  )
}
