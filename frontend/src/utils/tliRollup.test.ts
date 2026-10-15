/**
 * TLI rollup (owner, 2026-10-14: "agreed on the TLI merge"). With a comparison on, a year's
 * TLI rows roll into one "Teen Leadership Institute" line, so a year that ran TLI as two routes
 * compares with a year that ran one row. SCIT is never rolled up.
 */
import { describe, expect, it } from 'vitest'
import type { SessionBreakdown } from '../types/metrics'
import { TLI_ROLLUP_NAME, rollUpTliSessions } from './tliRollup'

function row(
  session_cm_id: number,
  session_name: string,
  session_type: string,
  count: number,
  capacity: number | null = 40
): SessionBreakdown {
  return {
    session_cm_id,
    session_name,
    session_type,
    count,
    capacity,
    utilization: capacity ? (count / capacity) * 100 : null,
  }
}

describe('rollUpTliSessions', () => {
  it('rolls every TLI row into one line at the first TLI row, summing count and capacity', () => {
    const rolled = rollUpTliSessions([
      row(1, 'Session A', 'main', 10),
      row(2, 'TLI: Route North', 'tli', 23, 30),
      row(3, 'Session B', 'main', 12),
      row(4, 'TLI: Route South', 'tli', 44, 50),
      row(5, 'Teen Leadership Institute', 'tli', 0, null),
    ])

    expect(rolled.map((r) => r.session_name)).toEqual(['Session A', TLI_ROLLUP_NAME, 'Session B'])
    expect(rolled[1]).toEqual({
      session_cm_id: 2,
      session_name: 'Teen Leadership Institute',
      session_type: 'tli',
      count: 67,
      capacity: 80,
      utilization: (67 / 80) * 100,
    })
  })

  it('names a lone TLI row "Teen Leadership Institute" whatever the year called it', () => {
    const rolled = rollUpTliSessions([row(7, 'TLI', 'tli', 43)])
    expect(rolled).toEqual([expect.objectContaining({ session_name: TLI_ROLLUP_NAME, count: 43 })])
  })

  it('leaves SCIT rows and a year with no TLI as they are', () => {
    const rows = [
      row(1, 'CIT', 'scit', 20),
      row(2, 'SIT', 'scit', 15),
      row(3, 'Session A', 'main', 9),
    ]
    expect(rollUpTliSessions(rows)).toEqual(rows)
  })

  it('reads capacity and utilization as null when no TLI row has a capacity', () => {
    const rolled = rollUpTliSessions([
      row(2, 'TLI A', 'tli', 5, null),
      row(3, 'TLI B', 'tli', 6, null),
    ])
    expect(rolled).toEqual([
      expect.objectContaining({ count: 11, capacity: null, utilization: null }),
    ])
  })
})
