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

  it('matches 2027 "Taste of Camp" with 2026 "Taste of Camp 1" (alias pin, 2026-10-14)', () => {
    const rows = buildSessionDetailRows([s('Taste of Camp', 14)], [s('Taste of Camp 1', 12)], true)

    expect(rows).toEqual([
      expect.objectContaining({ priorName: 'Taste of Camp 1', priorEnrolled: 12, retired: false }),
    ])
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

  describe('teen programs match by program type (ruling 12)', () => {
    const tli = (name: string, count: number) => s(name, count, { session_type: 'tli' })
    const scit = (name: string, count: number) => s(name, count, { session_type: 'scit' })

    it("compares a lone current TLI row with the sum of the prior year's TLI routes", () => {
      const rows = buildSessionDetailRows(
        [s('Session A', 10, { session_type: 'main' }), tli('TLI', 50)],
        [
          s('Session A', 8, { session_type: 'main' }),
          tli('TLI Route 1', 23),
          tli('TLI Route 2', 44),
        ],
        true
      )

      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        sessionName: 'Teen Leadership Institute',
        priorEnrolled: 67,
        delta: -17,
        retired: false,
      })
      expect(rows.some((r) => r.retired)).toBe(false)
    })

    it('names the prior session when one prior row of the type matched under another name', () => {
      const rows = buildSessionDetailRows([scit('CIT', 50)], [scit('CIT Track 1', 23)], true)

      expect(rows).toEqual([
        expect.objectContaining({ priorName: 'CIT Track 1', priorEnrolled: 23, delta: 27 }),
      ])
    })

    it('folds the other prior rows of the type into a lone current row that matched by name', () => {
      const rows = buildSessionDetailRows(
        [scit('CIT', 50)],
        [scit('CIT', 23), scit('CIT Track 2', 44)],
        true
      )

      expect(rows).toEqual([
        expect.objectContaining({
          sessionName: 'CIT',
          priorName: null,
          priorEnrolled: 67,
          delta: -17,
        }),
      ])
    })

    it('keeps name matches when the current year runs several rows of the type', () => {
      const rows = buildSessionDetailRows(
        [scit('CIT', 20), scit('SIT', 15)],
        [scit('CIT', 18), scit('SIT', 12)],
        true
      )

      expect(rows.map((r) => [r.sessionName, r.priorEnrolled, r.retired])).toEqual([
        ['CIT', 18, false],
        ['SIT', 12, false],
      ])
    })

    it("gives the type's unmatched prior rows to the first current row of the type with no match", () => {
      const rows = buildSessionDetailRows(
        [scit('CIT', 20), scit('SIT', 15)],
        [scit('CIT', 18), scit('SIT A', 5), scit('SIT B', 6)],
        true
      )

      expect(rows.map((r) => [r.sessionName, r.priorEnrolled, r.delta, r.retired])).toEqual([
        ['CIT', 18, 2, false],
        ['SIT', 11, 4, false],
      ])
    })

    it('still retires prior teen rows when the current year has none of that type', () => {
      const rows = buildSessionDetailRows(
        [s('Session A', 10, { session_type: 'main' })],
        [scit('CIT Track 1', 23)],
        true
      )

      expect(rows[1]).toMatchObject({ sessionName: 'CIT Track 1', retired: true, delta: -23 })
    })

    it('does not match non-teen sessions by type', () => {
      const rows = buildSessionDetailRows(
        [s('Session N', 7, { session_type: 'main' })],
        [s('Session B', 23, { session_type: 'main' })],
        true
      )

      expect(rows.map((r) => [r.sessionName, r.priorEnrolled, r.retired])).toEqual([
        ['Session N', null, false],
        ['Session B', 23, true],
      ])
    })

    it('keeps the Delta column summing to the real change', () => {
      const current = [s('Session A', 10, { session_type: 'main' }), tli('TLI', 50)]
      const prior = [
        s('Session A', 8, { session_type: 'main' }),
        s('Session B', 4, { session_type: 'main' }),
        tli('TLI Route 1', 23),
        tli('TLI Route 2', 44),
      ]
      const rows = buildSessionDetailRows(current, prior, true)

      expect(rows.reduce((sum, r) => sum + (r.delta ?? 0), 0)).toBe(60 - 79)
    })
  })
  describe('TLI rolls into one line in compare mode (owner, 2026-10-14)', () => {
    const tli = (name: string, count: number, capacity: number | null = 40) =>
      s(name, count, { session_type: 'tli', capacity })
    const main = (name: string, count: number) => s(name, count, { session_type: 'main' })
    const routesYear = [
      main('Session A', 8),
      tli('TLI: Route North', 23),
      tli('TLI: Route South', 44),
      tli('Teen Leadership Institute', 0, null),
    ]

    it('compares a one-row year with a two-route year as one line, with no retired TLI row', () => {
      const rows = buildSessionDetailRows(
        [main('Session A', 10), tli('Teen Leadership Institute', 45)],
        routesYear,
        true
      )

      expect(
        rows.map((r) => [r.sessionName, r.enrolled, r.priorEnrolled, r.delta, r.retired])
      ).toEqual([
        ['Session A', 10, 8, 2, false],
        ['Teen Leadership Institute', 45, 67, -22, false],
      ])
    })

    it('rolls up the current year too, so a two-route year has no dashed TLI row', () => {
      const rows = buildSessionDetailRows(routesYear, [main('Session A', 9), tli('TLI', 43)], true)

      expect(rows.map((r) => [r.sessionName, r.enrolled, r.priorEnrolled, r.delta])).toEqual([
        ['Session A', 8, 9, -1],
        ['Teen Leadership Institute', 67, 43, 24],
      ])
      expect(rows[1]).toMatchObject({ capacity: 80, priorName: null })
    })

    it('lists the routes separately with Compare off, as CampMinder has them', () => {
      const rows = buildSessionDetailRows(routesYear, null, false)

      expect(rows.map((r) => r.sessionName)).toEqual([
        'Session A',
        'TLI: Route North',
        'TLI: Route South',
        'Teen Leadership Institute',
      ])
    })

    it('does not roll up SCIT', () => {
      const scit = (name: string, count: number) => s(name, count, { session_type: 'scit' })
      const rows = buildSessionDetailRows(
        [scit('CIT', 20), scit('SIT', 15)],
        [scit('CIT', 18), scit('SIT', 12)],
        true
      )

      expect(rows.map((r) => r.sessionName)).toEqual(['CIT', 'SIT'])
    })
  })
})

describe('buildSessionDetailRows pairing (D-SESSION-MATCH)', () => {
  it('pairs an un-aliased rename that kept its CampMinder id and shows "was: …"', () => {
    const rows = buildSessionDetailRows(
      [s('Session 2b renamed', 20, { session_cm_id: 5 })],
      [s('Session 2 old', 18, { session_cm_id: 5 })],
      true
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ priorName: 'Session 2 old', priorEnrolled: 18, delta: 2 })
  })

  it('pairs by id before name', () => {
    const rows = buildSessionDetailRows(
      [s('Session 2', 10, { session_cm_id: 1 }), s('Session 3', 12, { session_cm_id: 2 })],
      [s('Session 2', 7, { session_cm_id: 2 }), s('Session 3', 9, { session_cm_id: 1 })],
      true
    )
    expect(rows[0]).toMatchObject({ priorEnrolled: 9 })
    expect(rows[1]).toMatchObject({ priorEnrolled: 7 })
  })
})
