/**
 * Session Enrollment Comparison rows use the shared session pairing (epic #3207,
 * D-SESSION-MATCH): ComparisonSummaryTable merges on a pair key instead of by name.
 */
import { describe, expect, it } from 'vitest'
import type { SessionBreakdown } from '../types/metrics'
import { mergeDataForComparison } from './comparisonUtils'
import { buildSessionComparisonData } from './sessionComparisonData'

function s(
  id: number,
  session_name: string,
  count: number,
  session_type: string = 'main'
): SessionBreakdown {
  return { session_cm_id: id, session_name, session_type, count, capacity: 40, utilization: 50 }
}

function merge(cur: SessionBreakdown[], prior: SessionBreakdown[]) {
  const { primaryData, compareData } = buildSessionComparisonData(cur, prior, {}, {})
  return mergeDataForComparison(primaryData, compareData, 'name', 'pairKey')
}

describe('buildSessionComparisonData', () => {
  it('shows an un-aliased rename with the same id as one row "was: …", not NEW + GONE', () => {
    const rows = merge([s(5, 'Session 2b', 20)], [s(5, 'Session 2', 18)])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ primaryValue: 20, compareValue: 18, change: 2 })
    expect(rows[0]?.compareName).toBeDefined()
  })

  it('pairs through the alias group when ids differ', () => {
    const rows = merge([s(10, 'Taste of Camp 1', 20)], [s(99, 'Taste of Camp', 18)])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ primaryValue: 20, compareValue: 18 })
  })

  it('pairs by exact name when ids differ', () => {
    const rows = merge([s(10, 'Session 3', 20)], [s(99, 'Session 3', 18)])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.compareName).toBeUndefined()
  })

  it('keeps rows that share a CampMinder id of 0 apart, each with its own prior', () => {
    const rows = merge(
      [s(0, 'Session 3', 20), s(0, 'Session 4', 22)],
      [s(0, 'Session 3', 18), s(0, 'Session 4', 25)]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ primaryValue: 20, compareValue: 18 })
    expect(rows[1]).toMatchObject({ primaryValue: 22, compareValue: 25 })
  })

  it('keeps an unmatched prior session as a GONE row and an unmatched current as NEW', () => {
    const rows = merge([s(1, 'Session 2', 20)], [s(2, 'Session 4', 18)])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ primaryValue: 20, compareValue: 0 })
    expect(rows[1]).toMatchObject({ primaryValue: 0, compareValue: 18 })
  })

  it('sums every prior teen row of a type into the current teen row', () => {
    const rows = merge(
      [s(50, 'SCIT 2026', 12, 'scit')],
      [s(60, 'CIT', 5, 'scit'), s(61, 'SIT', 4, 'scit')]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ primaryValue: 12, compareValue: 9 })
  })

  it('rolls TLI routes into one line before pairing', () => {
    const rows = merge(
      [s(70, 'TLI', 6, 'tli')],
      [s(71, 'TLI Route A', 3, 'tli'), s(72, 'TLI Route B', 2, 'tli')]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ primaryValue: 6, compareValue: 5 })
  })
})
