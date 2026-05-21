/**
 * Pure helper functions for CSV export across the bunking UI.
 *
 * These functions transform camper data into string[][] rows suitable for
 * passing to buildCsvContent(). They are extracted here so they can be
 * unit-tested without mounting React components.
 *
 * Column spec (shared for bunk, session, and all-campers exports):
 *   cm_id | first_name | last_name | bunk | session | age | grade
 *
 * Moved export interleaves prior_bunk next to bunk:
 *   cm_id | first_name | last_name | bunk | prior_bunk | session | age | grade
 *
 * Rows are always sorted by first_name (case-insensitive), then last_name as
 * tiebreak, so spreadsheet output is human-readable without re-sorting.
 */

import type { Camper, Session } from '../types/app-types'

// ---------------------------------------------------------------------------
// Column header constants
// ---------------------------------------------------------------------------

export const CAMPER_CSV_HEADERS = [
  'cm_id',
  'first_name',
  'last_name',
  'bunk',
  'session',
  'age',
  'grade',
] as const

export const MOVED_CSV_HEADERS = [
  'cm_id',
  'first_name',
  'last_name',
  'bunk',
  'prior_bunk',
  'session',
  'age',
  'grade',
] as const

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

function compareNames(aFirst: string, aLast: string, bFirst: string, bLast: string): number {
  const first = aFirst.toLocaleLowerCase().localeCompare(bFirst.toLocaleLowerCase())
  if (first !== 0) return first
  return aLast.toLocaleLowerCase().localeCompare(bLast.toLocaleLowerCase())
}

// ---------------------------------------------------------------------------
// buildCamperRows
// ---------------------------------------------------------------------------

export interface BuildCamperRowsOptions {
  /** If set, only include campers of this gender */
  filterGender?: 'M' | 'F' | 'NB'
}

/**
 * Convert an array of Camper objects into CSV row arrays.
 *
 * @param campers  - Camper records (already filtered to the desired set)
 * @param sessions - All sessions for the current year (used to look up session name)
 * @param options  - Optional filter overrides
 * @returns        - Array of string[] where each inner array is one CSV data row
 */
export function buildCamperRows(
  campers: Camper[],
  sessions: Session[],
  options: BuildCamperRowsOptions = {}
): string[][] {
  const sessionMap = new Map<number, string>()
  for (const s of sessions) {
    sessionMap.set(s.cm_id, s.name)
  }

  let filtered = campers
  if (options.filterGender !== undefined) {
    filtered = campers.filter((c) => c.gender === options.filterGender)
  }

  const sorted = filtered.toSorted((a, b) =>
    compareNames(a.first_name ?? '', a.last_name ?? '', b.first_name ?? '', b.last_name ?? '')
  )

  return sorted.map((c) => {
    const bunkName = c.expand?.assigned_bunk?.name ?? ''
    const sessionName = sessionMap.get(c.session_cm_id) ?? ''
    return [
      String(c.person_cm_id),
      c.first_name ?? '',
      c.last_name ?? '',
      bunkName,
      sessionName,
      String(c.age),
      String(c.grade),
    ]
  })
}

// ---------------------------------------------------------------------------
// buildMovedRows  (#28)
// ---------------------------------------------------------------------------

export interface MovedEntry {
  personCmId: number
  firstName: string
  lastName: string
  bunkName: string
  sessionName: string
  age: number
  grade: number
  priorBunkName: string
}

/**
 * Convert an array of MovedEntry objects into CSV row arrays for the
 * Scenario Comparison "Moved" tab export.
 *
 * @param moves - Moved camper entries
 * @returns     - Array of string[] where each inner array is one CSV data row
 */
export function buildMovedRows(moves: MovedEntry[]): string[][] {
  const sorted = moves.toSorted((a, b) =>
    compareNames(a.firstName, a.lastName, b.firstName, b.lastName)
  )
  return sorted.map((m) => [
    String(m.personCmId),
    m.firstName,
    m.lastName,
    m.bunkName,
    m.priorBunkName,
    m.sessionName,
    String(m.age),
    String(m.grade),
  ])
}
