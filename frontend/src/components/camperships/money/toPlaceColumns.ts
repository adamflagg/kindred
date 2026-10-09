/**
 * To place's table (§8.1; §4.3; final UX ★14): its six short columns and its grouping, as module-level
 * constants where they can be (AidTable's stability rule). Cells are cut off at the column edge and
 * every one carries its full words as a native title (§13); the opened row under the highlighted line
 * shows everything in full (D31; owner ruling A, 10-06).
 */
import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import type { AidCsvExtra, AidGrouping } from '../kit/AidTable'
import { moneyCsv } from '../kit/money'
import { campAidGroupWords, candidateDetail, candidateLabel } from './toPlaceModel'

/** Pinned widths, from the approved mock; with the select column and the flexible Suggestion, 1440 holds them. */
export const TO_PLACE_COLUMN_WIDTHS = {
  family: 196,
  line: 236,
  candidates: 214,
  suggestion: 250,
  confirm: 158,
  amount: 90,
} as const

/** The screen's headers in order, also the CSV's (the ids and the group follow as extras). */
export const CSV_COLUMN_HEADERS = [
  'Family',
  'The line in CampMinder',
  'Could belong to',
  'Suggestion',
  'What Confirm does',
  'Amount',
] as const

export const lineKey = (line: ApiAidToPlaceLine) => String(line.transaction_cm_id)

/** Search reaches the household id, the person on the line and every candidate camper (§4.3). */
export const lineSearch = (line: ApiAidToPlaceLine) => [
  line.household_cm_id,
  line.person,
  line.transaction_cm_id,
  ...line.candidates.map((c) => c.camper),
]

/** The candidates in one string, in full words, for sorting, searching and the CSV. */
export function candidatesCell(line: ApiAidToPlaceLine): string {
  return line.candidates.length === 0
    ? 'No application this season'
    : line.candidates.map((c) => `${candidateLabel(c)} (${candidateDetail(c)})`).join(', ')
}

/**
 * The ids the screen draws nowhere, and the part still not placed (ruling B dropped its column), so an
 * exported row joins back to CampMinder and keeps every figure the read sent.
 */
export const TO_PLACE_CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidToPlaceLine>> = [
  { header: 'Household CM id', value: (line) => String(line.household_cm_id) },
  { header: 'Line', value: (line) => String(line.transaction_cm_id) },
  { header: 'Still not placed', value: (line) => moneyCsv(line.unplaced) },
]

/** The ids and Still not placed, then Group: the reason heading under "Camp aid" (the grant lines say theirs). */
export function toPlaceCsvExtra(
  groups: ApiAidToPlace['groups']
): ReadonlyArray<AidCsvExtra<ApiAidToPlaceLine>> {
  const labels = new Map(groups.map((g) => [g.reason, g.label] as const))
  return [
    ...TO_PLACE_CSV_EXTRA,
    { header: 'Group', value: (line) => campAidGroupWords(labels.get(line.reason) ?? line.reason) },
  ]
}

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
 * "8 lines · 8 households": what a group holds on screen (counts, never money), muted beside its
 * heading. Distinct `household_cm_id`s, so "households", not D26 families: a split family counts
 * twice (plan review m11). The callout (what Confirm does) is its own line now (§16).
 */
export function groupWords(lines: readonly ApiAidToPlaceLine[]): string {
  const households = new Set(lines.map((l) => l.household_cm_id)).size
  return `${String(lines.length)} ${lines.length === 1 ? 'line' : 'lines'} · ${String(households)} ${households === 1 ? 'household' : 'households'}`
}
