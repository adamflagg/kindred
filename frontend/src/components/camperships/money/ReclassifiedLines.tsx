import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { TABLE, TD } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { lineFamily, lineWords } from './toPlaceModel'
import { SIDE_CARD } from './toPlaceStyles'

/**
 * Lines reclassified and waiting for the next ledger sync (D104; P-7), apart and not counted as
 * open: they can't be placed or left until the sync applies the reclassification. The heading's
 * figure is the server's `reclassified_total`.
 */
export function ReclassifiedLines({
  lines,
  total,
}: {
  lines: readonly ApiAidToPlaceLine[]
  total: number
}) {
  if (lines.length === 0) return null
  return (
    <section className="space-y-1.5" data-testid="reclassified-lines">
      <h3 className="text-sm font-semibold">
        Reclassified, waiting for the next ledger sync{' '}
        <span className="text-muted-foreground text-xs font-normal">
          {`${String(lines.length)} · ${formatMoney(total)} · not counted as open; can't be placed or left until the sync applies it`}
        </span>
      </h3>
      <div className={SIDE_CARD}>
        <table className={TABLE}>
          <tbody>
            {lines.map((line) => (
              <tr key={line.transaction_cm_id}>
                <td className={`${TD} w-44 whitespace-nowrap`}>
                  <HouseholdLabelText label={lineFamily(line)} className="font-medium" />
                </td>
                <td className={`${TD} whitespace-normal`}>
                  {lineWords(line)}
                  <div className="text-muted-foreground text-xs">→ {line.reclassified_to}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
