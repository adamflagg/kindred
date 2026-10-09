import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import {
  groupWords,
  lineKey,
  lineSearch,
  reasonGrouping,
  toPlaceCsvExtra,
  TO_PLACE_FAMILY_WIDTH,
  TO_PLACE_LINE_WIDTH,
  TO_PLACE_TEXT_COLUMNS,
} from './toPlaceColumns'
import { lineFamily, lineWords, stillNotPlacedWords } from './toPlaceModel'

/**
 * The family as the household card names it (ruling D): the label, a muted tie-break on a
 * collision, as a link to the household page (money-v2.html; R1-8c).
 */
function familyColumn(view: AidView): AidColumn<ApiAidToPlaceLine> {
  return {
    key: 'family',
    header: 'Family',
    width: TO_PLACE_FAMILY_WIDTH,
    pinned: true,
    value: (line) => labelWords(lineFamily(line)),
    render: (line) => (
      <Link
        to={aidHref(`/aid/households/${String(line.household_cm_id)}`, view)}
        className={`${CS_LINK_CELL}`}
      >
        <HouseholdLabelText label={lineFamily(line)} />
      </Link>
    ),
    searchable: true,
  }
}

/**
 * The line as CampMinder holds it, and (ruling B, owner 10-06) "· $X still not placed" under it only
 * where part of it already sits on a request. No "Not placed" column: the CSV keeps the figure.
 */
const LINE: AidColumn<ApiAidToPlaceLine> = {
  key: 'line',
  header: 'The line in CampMinder',
  width: TO_PLACE_LINE_WIDTH,
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

/**
 * To place's open lines (§8.1): one table, grouped by the server's reasons, searchable, a CSV of what
 * is on screen. A click (or ↑/↓) highlights a line and opens it in three panels under it, the
 * Requests grid's opened row (owner ruling A); Esc closes it. No footer total: the open total is the
 * server's, shown above the table (P-5).
 */
export function ToPlaceTable({
  data,
  view,
  csvFilename,
  csvAppend,
  renderRow,
  selected,
  onSelectedChange,
  onMatchingChange,
}: {
  data: ApiAidToPlace
  view: AidView
  csvFilename: string
  /** The grant lines as CSV rows (toPlaceModel.grantCsvRows), so the one file covers the whole tab. */
  csvAppend?: ReadonlyArray<readonly string[]> | undefined
  renderRow: (line: ApiAidToPlaceLine) => ReactNode
  selected?: ReadonlySet<string> | undefined
  onSelectedChange?: ((next: ReadonlySet<string>) => void) | undefined
  onMatchingChange?: ((keys: ReadonlySet<string>) => void) | undefined
}) {
  const rows = useMemo(() => data.groups.flatMap((g) => g.lines), [data.groups])
  const columns = useMemo(() => [familyColumn(view), LINE, ...TO_PLACE_TEXT_COLUMNS], [view])
  const groupings = useMemo(() => reasonGrouping(data.groups), [data.groups])
  const csvExtra = useMemo(() => toPlaceCsvExtra(data.groups), [data.groups])
  return (
    <AidTable
      rows={rows}
      columns={columns}
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
      csvExtra={csvExtra}
      csvAppend={csvAppend}
      emptyText="Nothing to place: every camp-aid line sits on a request."
    />
  )
}
