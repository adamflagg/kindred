import { useMemo, type ReactNode } from 'react'

import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { Money } from '../kit/MoneyText'
import {
  groupWords,
  lineKey,
  lineSearch,
  reasonGrouping,
  TO_PLACE_TEXT_COLUMNS,
  unplacedCsv,
} from './toPlaceColumns'

/** The family cell: the name, and the CampMinder household id under it (D27: ids cost no column). */
function familyCell(line: ApiAidToPlaceLine): ReactNode {
  return (
    <div>
      <div className="font-medium">{line.family || '—'}</div>
      <div className="text-muted-foreground text-xs">{line.household_cm_id}</div>
    </div>
  )
}

const FAMILY: AidColumn<ApiAidToPlaceLine> = {
  key: 'family',
  header: 'Family',
  width: 150,
  pinned: true,
  value: (line) => line.family,
  render: familyCell,
  searchable: true,
}

const NOT_PLACED: AidColumn<ApiAidToPlaceLine> = {
  key: 'unplaced',
  header: 'Not placed',
  width: 110,
  align: 'right',
  value: (line) => line.unplaced,
  render: (line) => <Money value={line.unplaced} />,
  csv: unplacedCsv,
}

/** The ids the screen draws inside other cells, so an exported row joins back to CampMinder. */
const CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidToPlaceLine>> = [
  { header: 'Household', value: (line) => String(line.household_cm_id) },
  { header: 'Line', value: (line) => String(line.transaction_cm_id) },
]

const COLUMNS: ReadonlyArray<AidColumn<ApiAidToPlaceLine>> = [
  FAMILY,
  NOT_PLACED,
  ...TO_PLACE_TEXT_COLUMNS,
]

/**
 * To place's open lines (§8.1): one table, grouped by the server's reasons, searchable, a CSV of what
 * is on screen. A click (or ↑/↓) highlights a line and opens its panel under it. No footer total:
 * the open total is the server's, shown above the table (Decision 5).
 */
export function ToPlaceTable({
  data,
  csvFilename,
  renderPanel,
  selected,
  onSelectedChange,
  onMatchingChange,
}: {
  data: ApiAidToPlace
  csvFilename: string
  renderPanel: (line: ApiAidToPlaceLine) => ReactNode
  selected?: ReadonlySet<string> | undefined
  onSelectedChange?: ((next: ReadonlySet<string>) => void) | undefined
  onMatchingChange?: ((keys: ReadonlySet<string>) => void) | undefined
}) {
  const rows = useMemo(() => data.groups.flatMap((g) => g.lines), [data.groups])
  const groupings = useMemo(() => reasonGrouping(data.groups), [data.groups])
  return (
    <AidTable
      rows={rows}
      columns={COLUMNS}
      rowKey={lineKey}
      searchExtra={lineSearch}
      groupings={groupings}
      defaultGrouping="reason"
      csvFilename={csvFilename}
      groupCount={groupWords}
      renderBelowHighlighted={(line) => renderPanel(line)}
      arrowKeys
      selected={selected}
      onSelectedChange={onSelectedChange}
      onMatchingChange={onMatchingChange}
      csvExtra={CSV_EXTRA}
      emptyText="Nothing to place: every camp-aid line sits on a request."
    />
  )
}
