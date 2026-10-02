import { useState } from 'react'

import { useAidReopenLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { ReasonForm } from '../household/ReasonForm'
import { TABLE, TD } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { inStaffWords } from './refusal'
import { lineWords } from './toPlaceModel'
import { SIDE_CARD } from './toPlaceStyles'

/**
 * The lines left at family level (D58), apart and not counted as open: each with its note, and
 * Reopen with a reason (casework). The heading's figure is the server's `left_total`.
 */
export function LeftLines({
  lines,
  total,
  year,
  canWork,
  onDone,
  onRefused,
}: {
  lines: readonly ApiAidToPlaceLine[]
  total: number
  year: number
  canWork: boolean
  onDone: (words: string) => void
  onRefused: (words: string) => void
}) {
  const reopen = useAidReopenLine()
  const [reopening, setReopening] = useState<number | null>(null)
  if (lines.length === 0) return null
  return (
    <section className="space-y-1.5" data-testid="left-lines">
      <h3 className="text-sm font-semibold">
        Left at family level{' '}
        <span className="text-muted-foreground text-xs font-normal">
          {`${String(lines.length)} · ${formatMoney(total)} · not counted as open`}
        </span>
      </h3>
      <div className={SIDE_CARD}>
        <table className={TABLE}>
          <tbody>
            {lines.map((line) => (
              <tr key={line.transaction_cm_id}>
                <td className={`${TD} w-36 font-medium whitespace-nowrap`}>{line.family}</td>
                <td className={`${TD} whitespace-normal`}>
                  {lineWords(line)}
                  <div className="text-muted-foreground text-xs">Left: {line.left_note}</div>
                  {reopening === line.transaction_cm_id && (
                    <div className="mt-2">
                      <ReasonForm
                        label="Reason"
                        submitLabel="Reopen"
                        onCancel={() => setReopening(null)}
                        onSubmit={async (reason) => {
                          try {
                            await inStaffWords(
                              reopen.mutateAsync({
                                year,
                                transactionCmId: line.transaction_cm_id,
                                reason,
                              })
                            )
                          } catch (caught) {
                            // Up to the tab: the refresh can drop this row and its form with it.
                            if (caught instanceof Error) onRefused(caught.message)
                            throw caught
                          }
                          setReopening(null)
                          onDone(`${line.family}: reopened; the line is open again.`)
                        }}
                      />
                    </div>
                  )}
                </td>
                <td className={`${TD} w-28 text-right whitespace-nowrap`}>
                  {canWork && reopening !== line.transaction_cm_id && (
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      onClick={() => setReopening(line.transaction_cm_id)}
                    >
                      Reopen…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
