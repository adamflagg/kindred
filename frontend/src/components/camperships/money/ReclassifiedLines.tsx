import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { Link } from 'react-router'

import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { ApartTable, type ApartColumn } from './ApartTable'
import { lineCell, lineFamily, lineWords } from './toPlaceModel'
import { GroupHeading } from './ToPlaceParts'

const columnsFor = (view: AidView): Array<ApartColumn<ApiAidToPlaceLine>> => [
  {
    key: 'family',
    header: 'Family',
    width: 196,
    title: (line) => labelWords(lineFamily(line)),
    render: (line) => (
      <Link
        to={aidHref(`/aid/households/${String(line.household_cm_id)}`, view)}
        className={`${CS_LINK_CELL} min-w-0 truncate`}
      >
        <HouseholdLabelText label={lineFamily(line)} />
      </Link>
    ),
  },
  {
    key: 'line',
    header: 'The line in CampMinder',
    width: 380,
    title: (line) => lineWords(line),
    render: lineCell,
  },
  {
    key: 'as',
    header: 'Reclassified as',
    help: "It can't be placed or left until the next ledger sync applies it",
    title: (line) => line.reclassified_to ?? '',
    render: (line) => `→ ${line.reclassified_to ?? ''}`,
  },
  {
    key: 'amount',
    header: 'Amount',
    width: 90,
    align: 'right',
    render: (line) => <Money value={line.amount} />,
  },
]

/**
 * Lines reclassified and waiting for the next ledger sync (D104; P-7), apart and not counted as open:
 * they can't be placed or left until the sync applies the reclassification (the header says so in its
 * title). The heading's figure is the server's `reclassified_total` (mock section 6).
 */
export function ReclassifiedLines({
  view,
  lines,
  total,
}: {
  view: AidView
  lines: readonly ApiAidToPlaceLine[]
  total: number
}) {
  if (lines.length === 0) return null
  return (
    <section data-testid="reclassified-lines">
      <GroupHeading
        title="Reclassified"
        meta={`${String(lines.length)} ${lines.length === 1 ? 'line' : 'lines'} · ${formatMoney(total)} · waits for the next ledger sync`}
      />
      <ApartTable
        columns={columnsFor(view)}
        rows={lines}
        rowKey={(line) => String(line.transaction_cm_id)}
      />
    </section>
  )
}
