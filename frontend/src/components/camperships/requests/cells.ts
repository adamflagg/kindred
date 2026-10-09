/**
 * The Requests grid's Session and Camper cells, pure (design-language §14, §15). The server sends the
 * row's `session_type`, `household_label` and its tiebreak (#3107); this decides the words.
 */
import type { ApiAidGridRow } from '../../../types/api-types'
import { sessionName } from '../../../utils/sessionName'
// Type only: householdModel imports views, which imports this, so a value import would be a cycle.
import type { HouseholdLabel } from '../household/householdModel'

/** The title of the dash a row with no session shows (§6: the badge sentence lives in a title). */
export const SESSION_UNCLEAR_TITLE =
  'Session unclear: no one enrolled session matches the request yet.'

/**
 * The Session cell (ruled 10-09, "Requests uses tiny everywhere"): the ruled tiny words, the full
 * name as the cell's title. `session_type` is `''` on an older read, which `sessionName` reads as "no
 * type", so it falls back by the name.
 */
export function sessionCell(row: ApiAidGridRow): { text: string; title: string } {
  if (row.session_name === '') return { text: '—', title: SESSION_UNCLEAR_TITLE }
  const tiny = sessionName(row.session_name, row.session_type ?? '', 'tiny')
  return { text: tiny || row.session_name, title: row.session_name }
}

/** A request with no camper: every Family Camp request, filed by the household. */
export const isHouseholdRequest = (row: ApiAidGridRow): boolean => row.camper_name === ''

/** The household's label for a household-level request (the family name when the label is empty); null for a camper's. */
export function householdLabelOf(row: ApiAidGridRow): HouseholdLabel | null {
  if (!isHouseholdRequest(row)) return null
  // The household card's own rule (householdModel.labelOf): the label trimmed, blank means none.
  const text = row.household_label?.trim() ?? ''
  if (text !== '') return { text, tiebreak: row.household_label_tiebreak?.trim() ?? '' }
  return row.family_name.trim() === '' ? null : { text: row.family_name, tiebreak: '' }
}

/**
 * What the Camper column reads, sorts, searches and exports (§15): the camper, else the household's
 * label, else the family name. Never "Household request".
 */
export function camperLabel(row: ApiAidGridRow): string {
  if (!isHouseholdRequest(row)) return row.camper_name
  return householdLabelOf(row)?.text ?? '—'
}

/** The Camper cell's native title. */
export function camperTitle(row: ApiAidGridRow): string {
  if (!isHouseholdRequest(row)) return row.camper_name
  const tiebreak = householdLabelOf(row)?.tiebreak ?? ''
  return `Household request (Family Camp): ${camperLabel(row)}${tiebreak === '' ? '' : ` · ${tiebreak}`}`
}
