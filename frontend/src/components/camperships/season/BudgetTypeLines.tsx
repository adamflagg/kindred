import { Money } from '../kit/MoneyText'
import { countWords } from '../requests/views'
import type { TypeLine } from './budgetModel'
import { TABLE_CARD } from '../kit/kitStyles'
import { RG_TABLE, RG_TD, RG_TD_NUM, RG_TH, RG_TH_NUM } from './rules/gridStyles'

/**
 * "In the budget, by decision type" (§7.2; read 3; owner ⚠2): one line per decision type that
 * counts toward the budget, leading with the type's own money (its top-up and discretionary
 * amounts), then the whole rounds' total it sits in, both as plain columns (final review ⚠1).
 * The section's own heading names it, so the table starts at its column headers (rounds-9).
 * Display only: no grid filter by decision type exists, so nothing here opens anything. Nothing
 * renders without lines.
 */
export function BudgetTypeLines({ lines }: { readonly lines: readonly TypeLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className={TABLE_CARD}>
      <table className={RG_TABLE}>
        <thead>
          <tr>
            <th className={RG_TH}>Decision type</th>
            <th className={RG_TH_NUM}>Requests</th>
            <th
              className={RG_TH_NUM}

              title="Money a named award brings from outside the rounds"
            >
              Own money
            </th>
            <th className={RG_TH_NUM}>Rounds total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} data-type-line={line.key}>
              <td className={RG_TD}>{line.label}</td>
              <td className={RG_TD_NUM}>{countWords(line.count)}</td>
              <td className={RG_TD_NUM}>
                <Money value={line.lead} />
              </td>
              <td className={RG_TD_NUM}>
                <Money value={line.amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
