/**
 * Household groups for the drill-down lists (epic #3207 PR 6b, decision 39).
 *
 * The key is the camper's primary childhood household in CampMinder (`household_cm_id`), never
 * the surname: one surname covers different families. Owner rulings on the mock (2026-10-15):
 * groups run where their first camper sits in the list's sort (#39), a household of one is
 * still a group (#41), a group is named for every surname in it (#44) plus its town (#45),
 * and it counts campers, adding enrollments on Enrollments rows when they differ (#40).
 */
import type { DrilldownAttendee } from '../../types/metrics'

export interface HouseholdGroup {
  /** "h<household cm_id>", or "p<person id>" for a camper with no household (a group of their own). */
  key: string
  /** Every surname in the group, A to Z, joined by " / " ("Baker / Rossi"). */
  label: string
  /** The first of its campers' own cities (the City column); undefined when none has one. */
  town: string | undefined
  /** The group's rows, in the list's order. */
  rows: DrilldownAttendee[]
  /** Distinct campers among the rows. */
  campers: number
}

const surnameOrder = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })

const householdKey = (row: DrilldownAttendee) =>
  row.household_cm_id != null ? `h${String(row.household_cm_id)}` : `p${String(row.person_id)}`

function byHousehold(rows: readonly DrilldownAttendee[]): Map<string, DrilldownAttendee[]> {
  const byKey = new Map<string, DrilldownAttendee[]>()
  for (const row of rows) {
    const key = householdKey(row)
    const members = byKey.get(key)
    if (members) members.push(row)
    else byKey.set(key, [row])
  }
  return byKey
}

/**
 * Groups `rows` (already sorted and searched) by household, in the order the rows run. A group's
 * name and town come from `namingRows` (the whole list, before search), so a search that hides
 * one camper does not rename the household.
 */
export function groupByHousehold(
  rows: readonly DrilldownAttendee[],
  namingRows: readonly DrilldownAttendee[] = rows
): HouseholdGroup[] {
  const naming = byHousehold(namingRows)
  return [...byHousehold(rows)].map(([key, members]) => {
    const named = naming.get(key) ?? members
    return {
      key,
      label: [...new Set(named.map((r) => r.last_name))].sort(surnameOrder).join(' / '),
      town: named.find((r) => r.city)?.city,
      rows: members,
      campers: new Set(members.map((r) => r.person_id)).size,
    }
  })
}

/** A group's count: "2 campers", or on Enrollments rows "2 campers · 3 enrollments" when they differ. */
export function householdCountWords(
  campers: number,
  enrollments: number,
  mode: 'campers' | 'enrollments'
): string {
  const words = `${String(campers)} camper${campers !== 1 ? 's' : ''}`
  return mode === 'enrollments' && enrollments !== campers
    ? `${words} · ${String(enrollments)} enrollment${enrollments !== 1 ? 's' : ''}`
    : words
}
