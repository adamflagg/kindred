import { useState } from 'react'

import { useAidReopenLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { Link } from 'react-router'

import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN2, CS_LINK_CELL } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { ApartTable, type ApartColumn } from './ApartTable'
import { ReasonEditor } from './ReasonEditor'
import { inStaffWords } from './refusal'
import { lineCell, lineFamily, lineWords } from './toPlaceModel'
import { GroupHeading } from './ToPlaceParts'

const plural = (n: number) => (n === 1 ? 'line' : 'lines')

/**
 * The lines left at family level (D58), apart and not counted as open: a heading and a muted meta, a
 * table (Family · The line · Why it was left · Amount · Reopen…), and Reopen with a reason (casework)
 * as an editor row under the line. The heading's figure is the server's `left_total` (mock section 6).
 */
export function LeftLines({
  view,
  lines,
  total,
  year,
  canWork,
  onDone,
  onRefused,
}: {
  view: AidView
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
  const columns: Array<ApartColumn<ApiAidToPlaceLine>> = [
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
      key: 'why',
      header: 'Why it was left',
      title: (line) => line.left_note ?? '',
      render: (line) => line.left_note,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 90,
      align: 'right',
      render: (line) => <Money value={line.amount} />,
    },
    {
      key: 'act',
      header: '',
      width: 104,
      render: (line) =>
        canWork && reopening !== line.transaction_cm_id ? (
          <button
            type="button"
            className={CS_BTN2}
            onClick={() => setReopening(line.transaction_cm_id)}
          >
            Reopen…
          </button>
        ) : null,
    },
  ]
  return (
    <section data-testid="left-lines">
      <GroupHeading
        title="Left at family level"
        meta={`${String(lines.length)} ${plural(lines.length)} · ${formatMoney(total)} · not in the open count`}
      />
      <ApartTable
        columns={columns}
        rows={lines}
        rowKey={(line) => String(line.transaction_cm_id)}
        detail={(line) =>
          reopening === line.transaction_cm_id ? (
            <ReasonEditor
              title="Reopen"
              // The left-lines table is white: the band tint (owner 10-10, "green on white").
              onWhite
              label="Reason"
              submitLabel="Reopen"
              hint="The line is open again · Reopen needs a reason"
              onCancel={() => setReopening(null)}
              onSubmit={async (reason) => {
                let written: number
                try {
                  ;({ written } = await inStaffWords(
                    reopen.mutateAsync({
                      year,
                      transactionCmId: line.transaction_cm_id,
                      reason,
                    })
                  ))
                } catch (caught) {
                  // Up to the tab: the refresh can drop this row and its form with it.
                  if (caught instanceof Error) onRefused(caught.message)
                  throw caught
                }
                setReopening(null)
                onDone(
                  written === 0
                    ? `${lineFamily(line).text}: already open; nothing changed.`
                    : `${lineFamily(line).text}: reopened · the line is open again`
                )
              }}
            />
          ) : null
        }
      />
    </section>
  )
}
