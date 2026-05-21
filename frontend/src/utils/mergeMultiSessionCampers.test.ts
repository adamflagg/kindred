/**
 * Tests for mergeMultiSessionCampers + the readonly contract on its output types.
 *
 * TDD (#1596): the `@ts-expect-error` assertions in "readonly contract" are the
 * spec — they only type-check once `AdditionalSession`'s fields and
 * `MergedCamper.additionalSessions` are `readonly`, matching the `readonly`
 * `Camper` that `MergedCamper` extends. Verified via `tsc --noEmit`; before the
 * change the directives are unused → TS2578.
 */
import { describe, it, expect } from 'vitest'
import { mergeMultiSessionCampers } from './mergeMultiSessionCampers'
import type { AdditionalSession, MergedCamper } from './mergeMultiSessionCampers'
import type { Camper, Session } from '../types/app-types'

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
    ...overrides,
  } as unknown as Camper
}

function makeSession(overrides: Partial<Session> = {}): Session {
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
// Behavioral coverage
// ---------------------------------------------------------------------------

describe('mergeMultiSessionCampers', () => {
  it('collapses two enrollments of one person into a single entry with additionalSessions', () => {
    const campers = [
      makeCamper({ id: 'p1:s1', session_cm_id: 1000001 }),
      makeCamper({ id: 'p1:s2', session_cm_id: 1000002, assigned_bunk_cm_id: 3000002 }),
    ]
    const sessions = [
      makeSession({ cm_id: 1000001, name: 'Session 1A', session_type: 'main' }),
      makeSession({ cm_id: 1000002, name: 'Session 2A', session_type: 'embedded' }),
    ]

    const merged = mergeMultiSessionCampers(campers, sessions)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.additionalSessions).toHaveLength(1)
    expect(merged[0]?.additionalSessions?.[0]?.session_cm_id).toBe(1000002)
    expect(merged[0]?.additionalSessions?.[0]?.session_name).toBe('Session 2A')
  })

  it('leaves a single-session camper untouched (no additionalSessions)', () => {
    const merged = mergeMultiSessionCampers([makeCamper()], [makeSession()])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.additionalSessions).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Readonly contract (#1596) — type-level spec, enforced by tsc --noEmit
// ---------------------------------------------------------------------------

describe('readonly contract', () => {
  it('AdditionalSession fields are readonly', () => {
    const addl: AdditionalSession = {
      session_cm_id: 1000002,
      session_name: 'Session 2A',
    }

    // @ts-expect-error - session_cm_id is readonly
    addl.session_cm_id = 999
    // @ts-expect-error - session_name is readonly
    addl.session_name = 'mutated'
    // @ts-expect-error - bunk_cm_id is readonly
    addl.bunk_cm_id = 3000003

    expect(addl.session_name).toBeDefined()
  })

  it('MergedCamper.additionalSessions is a readonly array', () => {
    const merged: MergedCamper = {
      ...makeCamper(),
      additionalSessions: [{ session_cm_id: 1000002, session_name: 'Session 2A' }],
    }

    // @ts-expect-error - readonly array is not assignable to a mutable AdditionalSession[]
    const mutable: AdditionalSession[] = merged.additionalSessions ?? []

    expect(mutable).toHaveLength(1)
  })
})
