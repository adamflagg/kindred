/**
 * Tests for CSV export helper row-building functions.
 * These helpers are pure functions that take camper data and return string[][] rows,
 * making them easy to test independently of React components.
 *
 * TDD: Tests written before implementation.
 */
import { describe, it, expect } from 'vitest'
import { buildCamperRows, buildMovedRows } from './csvExportHelpers'
import type { Camper, Session, Bunk } from '../types/app-types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCamper(overrides: Record<string, unknown> = {}): Camper {
  return {
    id: 'person-1:session-1',
    name: 'Emma Johnson',
    first_name: 'Emma',
    last_name: 'Johnson',
    age: 12.5,
    grade: 7,
    gender: 'F',
    session_cm_id: 1000001,
    person_cm_id: 2000001,
    assigned_bunk: 'bunk-pb-id-1',
    assigned_bunk_cm_id: 3000001,
    created: '2025-01-01',
    updated: '2025-01-01',
    expand: {
      assigned_bunk: {
        id: 'bunk-pb-id-1',
        name: 'G-6',
        gender: 'f',
        cm_id: 3000001,
      } as unknown as Bunk,
    },
    ...overrides,
  } as unknown as Camper
}

function makeSession(overrides: Partial<Session> = {}): Session {
  // Cast through unknown to avoid IsoAutoDateString branded-type issues in tests
  return {
    id: 'session-pb-id-1',
    cm_id: 1000001,
    name: 'Session 1A',
    session_type: 'main',
    year: 2025,
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    parent_id: '',
    ...overrides,
  } as unknown as Session
}

// ---------------------------------------------------------------------------
// buildCamperRows
// ---------------------------------------------------------------------------
describe('buildCamperRows', () => {
  it('returns one row per camper', () => {
    const campers = [
      makeCamper({ person_cm_id: 2000001, first_name: 'Emma', last_name: 'Johnson' }),
      makeCamper({ person_cm_id: 2000002, first_name: 'Liam', last_name: 'Garcia', gender: 'M' }),
    ]
    const sessions: Session[] = [makeSession()]
    const rows = buildCamperRows(campers, sessions)
    expect(rows).toHaveLength(2)
  })

  it('includes cm_id, first_name, last_name in each row', () => {
    const camper = makeCamper({ person_cm_id: 2000001, first_name: 'Emma', last_name: 'Johnson' })
    const rows = buildCamperRows([camper], [makeSession()])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![0]).toBe('2000001') // cm_id
    expect(row![1]).toBe('Emma') // first_name
    expect(row![2]).toBe('Johnson') // last_name
  })

  it('includes bunk name from expand.assigned_bunk', () => {
    const camper = makeCamper()
    const rows = buildCamperRows([camper], [makeSession()])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![3]).toBe('G-6') // bunk
  })

  it('uses empty string for bunk when unassigned', () => {
    const camper = makeCamper({
      assigned_bunk: undefined,
      assigned_bunk_cm_id: undefined,
      expand: {},
    })
    const rows = buildCamperRows([camper], [makeSession()])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![3]).toBe('') // bunk empty
  })

  it('includes session name in row', () => {
    const session = makeSession({ cm_id: 1000001, name: 'Session 1A' })
    const camper = makeCamper({ session_cm_id: 1000001 })
    const rows = buildCamperRows([camper], [session])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![4]).toBe('Session 1A') // session
  })

  it('uses empty string for session when not found', () => {
    const camper = makeCamper({ session_cm_id: 9999999 })
    const rows = buildCamperRows([camper], [])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![4]).toBe('') // session
  })

  it('includes age as string in row', () => {
    const camper = makeCamper({ age: 12.5 })
    const rows = buildCamperRows([camper], [makeSession()])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![5]).toBe('12.5') // age
  })

  it('includes grade as string in row', () => {
    const camper = makeCamper({ grade: 7 })
    const rows = buildCamperRows([camper], [makeSession()])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![6]).toBe('7') // grade
  })

  // Runtime data from CampMinder can have a missing age/grade even though the
  // Camper type declares them as `number`. The cell must be '' — never the
  // literal string "null"/"undefined" (which String(null/undefined) produces).
  it('uses empty string for age when null', () => {
    const camper = makeCamper({ age: null })
    const rows = buildCamperRows([camper], [makeSession()])
    expect(rows[0]![5]).toBe('') // age, not "null"
  })

  it('uses empty string for age when undefined', () => {
    const camper = makeCamper({ age: undefined })
    const rows = buildCamperRows([camper], [makeSession()])
    expect(rows[0]![5]).toBe('') // age, not "undefined"
  })

  it('uses empty string for grade when null', () => {
    const camper = makeCamper({ grade: null })
    const rows = buildCamperRows([camper], [makeSession()])
    expect(rows[0]![6]).toBe('') // grade, not "null"
  })

  it('uses empty string for grade when undefined', () => {
    const camper = makeCamper({ grade: undefined })
    const rows = buildCamperRows([camper], [makeSession()])
    expect(rows[0]![6]).toBe('') // grade, not "undefined"
  })

  it('filters to only girls when filterGender is F', () => {
    const campers = [
      makeCamper({ person_cm_id: 2000001, gender: 'F', first_name: 'Emma', last_name: 'Johnson' }),
      makeCamper({ person_cm_id: 2000002, gender: 'M', first_name: 'Liam', last_name: 'Garcia' }),
    ]
    const rows = buildCamperRows(campers, [makeSession()], { filterGender: 'F' })
    expect(rows).toHaveLength(1)
    expect(rows[0]![1]).toBe('Emma')
  })

  it('does not filter when filterGender is undefined', () => {
    const campers = [
      makeCamper({ person_cm_id: 2000001, gender: 'F' }),
      makeCamper({ person_cm_id: 2000002, gender: 'M' }),
    ]
    const rows = buildCamperRows(campers, [makeSession()])
    expect(rows).toHaveLength(2)
  })

  it('sorts rows by first name (case-insensitive), then last name', () => {
    const campers = [
      makeCamper({ person_cm_id: 1, first_name: 'liam', last_name: 'Garcia' }),
      makeCamper({ person_cm_id: 2, first_name: 'Ava', last_name: 'Brown' }),
      makeCamper({ person_cm_id: 3, first_name: 'ava', last_name: 'Adams' }),
    ]
    const rows = buildCamperRows(campers, [makeSession()])
    expect(rows.map((r) => r[1])).toEqual(['ava', 'Ava', 'liam'])
    expect(rows.map((r) => r[2])).toEqual(['Adams', 'Brown', 'Garcia'])
  })
})

// ---------------------------------------------------------------------------
// buildMovedRows  (#28)
// ---------------------------------------------------------------------------

interface MovedEntry {
  personCmId: number
  firstName: string
  lastName: string
  bunkName: string
  sessionName: string
  age: number
  grade: number
  priorBunkName: string
}

describe('buildMovedRows', () => {
  const makeMove = (overrides: Partial<MovedEntry> = {}): MovedEntry => ({
    personCmId: 2000001,
    firstName: 'Emma',
    lastName: 'Johnson',
    bunkName: 'G-7',
    sessionName: 'Session 1A',
    age: 12.5,
    grade: 7,
    priorBunkName: 'G-6',
    ...overrides,
  })

  it('returns one row per moved camper', () => {
    const moves = [
      makeMove({ personCmId: 2000001, firstName: 'Emma', lastName: 'Johnson' }),
      makeMove({ personCmId: 2000002, firstName: 'Liam', lastName: 'Garcia' }),
    ]
    const rows = buildMovedRows(moves)
    expect(rows).toHaveLength(2)
  })

  it('includes cm_id, first_name, last_name, bunk, prior_bunk, session, age, grade', () => {
    const move = makeMove({
      personCmId: 2000001,
      firstName: 'Emma',
      lastName: 'Johnson',
      bunkName: 'G-7',
      sessionName: 'Session 1A',
      age: 12.5,
      grade: 7,
      priorBunkName: 'G-6',
    })
    const rows = buildMovedRows([move])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row![0]).toBe('2000001') // cm_id
    expect(row![1]).toBe('Emma') // first_name
    expect(row![2]).toBe('Johnson') // last_name
    expect(row![3]).toBe('G-7') // bunk (new)
    expect(row![4]).toBe('G-6') // prior_bunk (next to bunk)
    expect(row![5]).toBe('Session 1A') // session
    expect(row![6]).toBe('12.5') // age
    expect(row![7]).toBe('7') // grade
  })

  it('handles empty moved list', () => {
    const rows = buildMovedRows([])
    expect(rows).toHaveLength(0)
  })

  it('sorts moved rows by first name (case-insensitive), then last name', () => {
    const moves = [
      makeMove({ personCmId: 1, firstName: 'liam', lastName: 'Garcia' }),
      makeMove({ personCmId: 2, firstName: 'Ava', lastName: 'Brown' }),
      makeMove({ personCmId: 3, firstName: 'ava', lastName: 'Adams' }),
    ]
    const rows = buildMovedRows(moves)
    expect(rows.map((r) => r[1])).toEqual(['ava', 'Ava', 'liam'])
    expect(rows.map((r) => r[2])).toEqual(['Adams', 'Brown', 'Garcia'])
  })
})

// ---------------------------------------------------------------------------
// Column header constants
// ---------------------------------------------------------------------------
import { CAMPER_CSV_HEADERS, MOVED_CSV_HEADERS } from './csvExportHelpers'

describe('CSV header constants', () => {
  it('CAMPER_CSV_HEADERS has 7 columns', () => {
    expect(CAMPER_CSV_HEADERS).toHaveLength(7)
  })

  it('MOVED_CSV_HEADERS has 8 columns (adds prior_bunk)', () => {
    expect(MOVED_CSV_HEADERS).toHaveLength(8)
  })

  it('CAMPER_CSV_HEADERS starts with cm_id', () => {
    expect(CAMPER_CSV_HEADERS[0]).toBe('cm_id')
  })

  it('MOVED_CSV_HEADERS places prior_bunk directly after bunk', () => {
    const bunkIdx = MOVED_CSV_HEADERS.indexOf('bunk')
    expect(bunkIdx).toBeGreaterThanOrEqual(0)
    expect(MOVED_CSV_HEADERS[bunkIdx + 1]).toBe('prior_bunk')
  })
})
