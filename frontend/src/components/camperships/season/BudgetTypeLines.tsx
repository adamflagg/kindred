import { Money } from '../kit/MoneyText'
import { TABLE_CARD } from '../kit/kitStyles'
import { countWords } from '../requests/views'
import type { TypeLine } from './budgetModel'
import { TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from './seasonStyles'

/**
 * "In the budget, by decision type" (§7.2; read 3; owner ⚠2): one line per decision type that
 * counts toward the budget, leading with the type's own money. Display only: no grid filter by
 * decision type exists, so nothing here opens anything. Nothing renders without lines.
 */
export function BudgetTypeLines({ lines }: { readonly lines: readonly TypeLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className={TABLE_CARD}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={TH_LABEL}>In the budget, by decision type</th>
            <th className={TH_MONEY}>Requests</th>
            <th className={TH_MONEY}>Own money</th>
            <th className={TH_LABEL} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} data-type-line={line.key}>
              <td className={TD_LABEL}>{line.label}</td>
              <td className={TD_MONEY}>{countWords(line.count)}</td>
              <td className={TD_MONEY}>
                <Money value={line.lead} />
              </td>
              <td className={`${TD_LABEL} text-muted-foreground text-xs`}>{line.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
