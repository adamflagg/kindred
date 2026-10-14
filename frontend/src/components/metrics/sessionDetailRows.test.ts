/**
 * Session Details rows (decision 43 / K8): in compare mode a prior-year session with no
 * alias-resolved current match is a row of its own, so the Delta column sums to the real change.
 */
import { describe, expect, it } from 'vitest'
import type { SessionBreakdown } from '../../types/metrics'
import { buildSessionDetailRows } from './sessionDetailRows'

function s(
  session_name: string,
  count: number,
  extra: Partial<SessionBreakdown> = {}
): SessionBreakdown {
  return {
    session_cm_id: 0,
    session_name,
    count,
    capacity: 40,
    utilization: (count / 40) * 100,
    ...extra,
  }
}

describe('buildSessionDetailRows', () => {
  it('appends a prior session with no current match as a retired row', () => {
    const rows = buildSessionDetailRows(
      [s('Session A', 10)],
      [s('Session A', 8), s('Session B', 23)],
      true
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      sessionName: 'Session A',
      enrolled: 10,
      priorEnrolled: 8,
      delta: 2,
      retired: false,
    })
    expect(rows[1]).toMatchObject({
      sessionName: 'Session B',
      enrolled: null,
      capacity: null,
      utilization: null,
      priorEnrolled: 23,
      delta: -23,
      retired: true,
    })
  })

  it('matches a renamed prior session through its alias, adding no retired row', () => {
    const rows = buildSessionDetailRows([s('Taste of Camp 1', 12)], [s('Taste of Camp', 9)], true)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionName: 'Taste of Camp 1',
      priorName: 'Taste of Camp',
      priorEnrolled: 9,
      delta: 3,
      retired: false,
    })
  })

  it('adds no rows and no prior values outside compare mode', () => {
    const rows = buildSessionDetailRows([s('Session A', 10)], [s('Session B', 23)], false)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionName: 'Session A', priorEnrolled: null, delta: null })
  })

  it('treats compare mode with no prior data as non-compare', () => {
    const rows = buildSessionDetailRows([s('Session A', 10)], undefined, true)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ priorEnrolled: null, delta: null, retired: false })
  })

  it('keeps current rows in their order and puts retired rows after them', () => {
    const rows = buildSessionDetailRows(
      [s('Session A', 10), s('Session C', 5)],
      [s('Session B', 23), s('Session A', 8), s('Session D', 4)],
      true
    )

    expect(rows.map((r) => r.sessionName)).toEqual([
      'Session A',
      'Session C',
      'Session B',
      'Session D',
    ])
    expect(rows.map((r) => r.retired)).toEqual([false, false, true, true])
  })

  it('leaves a current session with no prior match unmatched, not retired', () => {
    const rows = buildSessionDetailRows([s('Session N', 7)], [], true)

    expect(rows).toEqual([
      expect.objectContaining({
        sessionName: 'Session N',
        priorEnrolled: null,
        delta: null,
        retired: false,
      }),
    ])
  })

  it('sums the Delta column to the real change once retired rows are in', () => {
    const current = [s('Session A', 10), s('Session N', 7)]
    const prior = [s('Session A', 8), s('Session B', 23)]
    const rows = buildSessionDetailRows(current, prior, true)

    const matchedAndRetired = rows.reduce((sum, r) => sum + (r.delta ?? 0), 0)
    const newOnly = rows
      .filter((r) => r.priorEnrolled === null)
      .reduce((sum, r) => sum + (r.enrolled ?? 0), 0)
    expect(matchedAndRetired + newOnly).toBe(17 - 31)
  })
})
