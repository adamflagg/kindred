/**
 * How Money and Grants name a family (owner ruling D, 10-06: "the household card's label, DRY"): the
 * server's `label` (the adults' names, else the mailing title) and its `label_tiebreak` (a city or
 * "#<cm id>", only when two rows of the same read collide), computed by the household page's own
 * helper (PR 0). A row whose label is blank keeps the name it had before (`fallback`).
 */
import { labelOf, type HouseholdLabel } from '../household/householdModel'

export function familyLabel(
  row: { readonly label?: string | undefined; readonly label_tiebreak?: string | undefined },
  fallback: string
): HouseholdLabel {
  return labelOf(row) ?? { text: fallback.trim() === '' ? '—' : fallback, tiebreak: '' }
}
