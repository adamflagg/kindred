import { useMemo, type ReactNode } from 'react'

import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { AidTable, type AidColumn } from '../kit/AidTable'
import {
  groupWords,
  lineKey,
  lineSearch,
  reasonGrouping,
  TO_PLACE_CSV_EXTRA,
  TO_PLACE_TEXT_COLUMNS,
} from './toPlaceColumns'
import { lineWords, stillNotPlacedWords } from './toPlaceModel'

/** The family. No household id under it: the id is a tie-break only (owner, 10-05); the CSV keeps it. */
const FAMILY: AidColumn<ApiAidToPlaceLine> = {
  key: 'family',
  header: 'Family',
  width: 190,
  pinned: true,
  value: (line) => line.family,
  render: (line) => <span className="font-medium">{line.family || '—'}</span>,
  searchable: true,
}

/**
 * The line as CampMinder holds it, and (ruling B, owner 10-06) "· $X still not placed" under it only
 * where part of it already sits on a request. No "Not placed" column: the CSV keeps the figure.
 */
const LINE: AidColumn<ApiAidToPlaceLine> = {
  key: 'line',
  header: 'The line in CampMinder',
  width: 300,
  value: lineWords,
  render: (line) => {
    const still = stillNotPlacedWords(line)
    return (
      <>
        {lineWords(line)}
        {still !== null && <span className="text-muted-foreground block text-xs">{still}</span>}
      </>
    )
  },
  searchable: true,
}

const COLUMNS: ReadonlyArray<AidColumn<ApiAidToPlaceLine>> = [
  FAMILY,
  LINE,
  ...TO_PLACE_TEXT_COLUMNS,
]

/**
 * To place's open lines (§8.1): one table, grouped by the server's reasons, searchable, a CSV of what
 * is on screen. A click (or ↑/↓) highlights a line and opens it in three panels under it, the
 * Requests grid's opened row (owner ruling A); Esc closes it. No footer total: the open total is the
 * server's, shown above the table (P-5).
 */
export function ToPlaceTable({
  data,
  csvFilename,
  renderRow,
  selected,
  onSelectedChange,
  onMatchingChange,
}: {
  data: ApiAidToPlace
  csvFilename: string
  renderRow: (line: ApiAidToPlaceLine) => ReactNode
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
      renderDetail={(line) => renderRow(line)}
      arrowKeys
      selected={selected}
      onSelectedChange={onSelectedChange}
      onMatchingChange={onMatchingChange}
      csvExtra={TO_PLACE_CSV_EXTRA}
      emptyText="Nothing to place: every camp-aid line sits on a request."
    />
  )
}
