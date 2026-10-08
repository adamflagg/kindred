/**
 * To place's table (§8.1; §4.3; money-v2.html): its columns and grouping, as module-level constants
 * where they can be (AidTable's stability rule). Cells are cut off at the column edge; the opened row
 * under the highlighted line shows everything in full (D31; owner ruling A, 10-06).
 */
import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import type { AidColumn, AidCsvExtra, AidGrouping } from '../kit/AidTable'
import { moneyCsv } from '../kit/money'
import { candidateDetail, candidateLabel, confirmSummary, suggestionWords } from './toPlaceModel'

export const lineKey = (line: ApiAidToPlaceLine) => String(line.transaction_cm_id)

/** Search reaches the household id, the person on the line and every candidate camper (§4.3). */
export const lineSearch = (line: ApiAidToPlaceLine) => [
  line.household_cm_id,
  line.person,
  line.transaction_cm_id,
  ...line.candidates.map((c) => c.camper),
]

/** The candidates in one cell: "Emma Johnson · Session 2 ($2,200 not yet in CampMinder), …". */
export function candidatesCell(line: ApiAidToPlaceLine): string {
  return line.candidates.length === 0
    ? 'No application this season'
    : line.candidates.map((c) => `${candidateLabel(c)} (${candidateDetail(c)})`).join(', ')
}

/** Columns with no cell renderer: the table writes each one's value as text (and in the CSV). */
export const TO_PLACE_TEXT_COLUMNS: ReadonlyArray<AidColumn<ApiAidToPlaceLine>> = [
  {
    key: 'candidates',
    header: 'Requests it could belong to · not yet in CampMinder',
    width: 280,
    value: candidatesCell,
  },
  {
    key: 'suggestion',
    header: 'Suggestion and its evidence',
    flex: true,
    value: suggestionWords,
  },
  {
    key: 'confirm',
    header: 'What Confirm does',
    width: 220,
    value: confirmSummary,
  },
]

/**
 * The ids the screen draws nowhere, and the part still not placed (ruling B dropped its column), so an
 * exported row joins back to CampMinder and keeps every figure the read sent.
 */
export const TO_PLACE_CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidToPlaceLine>> = [
  { header: 'Household', value: (line) => String(line.household_cm_id) },
  { header: 'Line', value: (line) => String(line.transaction_cm_id) },
  { header: 'Still not placed', value: (line) => moneyCsv(line.unplaced) },
]

/** Grouped by the server's reasons, in its words and order (§8.1: "grouped by reason"). */
export function reasonGrouping(
  groups: ApiAidToPlace['groups']
): ReadonlyArray<AidGrouping<ApiAidToPlaceLine>> {
  const labels = new Map(groups.map((g) => [g.reason, g.label] as const))
  return [
    {
      key: 'reason',
      // A switch label, as the Requests grid's "Flat / By reason" (requests/RequestsGrid.tsx).
      label: 'By reason',
      groupOf: (line) => ({ id: line.reason, heading: labels.get(line.reason) ?? line.reason }),
    },
  ]
}

/**
 * "2 households · 3 lines": what a group holds on screen (counts, never money). Distinct
 * `household_cm_id`s, so "households", not D26 families: a split family counts twice (plan review m11).
 */
export function groupWords(lines: readonly ApiAidToPlaceLine[]): string {
  const households = new Set(lines.map((l) => l.household_cm_id)).size
  return `${String(households)} ${households === 1 ? 'household' : 'households'} · ${String(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}`
}
