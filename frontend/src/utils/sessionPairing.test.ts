/**
 * Session pairing (epic #3207, D-SESSION-MATCH): the one rule Overview's Session Details and
 * Session Enrollment Comparison tables use to pair a session with last year's. CampMinder id
 * first, then the alias group, then exact name; one-to-one; teens by program type last.
 */
import { describe, expect, it } from 'vitest'
import type { SessionBreakdown } from '../types/metrics'
import { pairSessions } from './sessionPairing'

function s(
  id: number,
  session_name: string,
  count: number,
  session_type: string = 'main'
): SessionBreakdown {
  return { session_cm_id: id, session_name, session_type, count, capacity: 40, utilization: 50 }
}

describe('pairSessions', () => {
  it('pairs by CampMinder id before name', () => {
    const cur = [s(1, 'Session 2', 10), s(2, 'Session 3', 12)]
    // Same names, but the ids cross: id wins.
    const prior = [s(2, 'Session 2', 7), s(1, 'Session 3', 9)]
    const { pairs, retired } = pairSessions(cur, prior)
    expect(pairs[0]).toEqual([prior[1]])
    expect(pairs[1]).toEqual([prior[0]])
    expect(retired).toEqual([])
  })

  it('pairs a renamed session with a new id through the alias group', () => {
    const cur = [s(10, 'Taste of Camp 1', 20)]
    const prior = [s(99, 'Taste of Camp', 18)]
    expect(pairSessions(cur, prior).pairs[0]).toEqual(prior)
  })

  it('pairs the alias group in the other direction too', () => {
    const cur = [s(10, 'Taste of Camp', 20)]
    const prior = [s(99, 'Taste of Camp 1', 18)]
    expect(pairSessions(cur, prior).pairs[0]).toEqual(prior)
  })

  it('falls back to exact name when ids differ', () => {
    const cur = [s(10, 'Session 2', 20)]
    const prior = [s(99, 'Session 2', 18)]
    expect(pairSessions(cur, prior).pairs[0]).toEqual(prior)
  })

  it('pairs an un-aliased rename that kept its id', () => {
    const cur = [s(5, 'Session 2 (renamed)', 20)]
    const prior = [s(5, 'Session 2', 18)]
    const { pairs, retired } = pairSessions(cur, prior)
    expect(pairs[0]).toEqual(prior)
    expect(retired).toEqual([])
  })

  it('uses a prior row once', () => {
    const cur = [s(1, 'Session 2', 10), s(2, 'Session 2', 11)]
    const prior = [s(1, 'Session 2', 7)]
    const { pairs } = pairSessions(cur, prior)
    expect(pairs[0]).toEqual(prior)
    expect(pairs[1]).toEqual([])
  })

  it('returns unmatched prior rows as retired', () => {
    const cur = [s(1, 'Session 2', 10)]
    const prior = [s(1, 'Session 2', 7), s(3, 'Session 4', 9)]
    expect(pairSessions(cur, prior).retired).toEqual([prior[1]])
  })

  it('gives every prior teen row of a type to the current rows of that type', () => {
    const cur = [s(1, 'Session 2', 10), s(50, 'SCIT 2026', 12, 'scit')]
    const prior = [
      s(1, 'Session 2', 7),
      s(60, 'CIT', 5, 'scit'),
      s(61, 'SIT', 4, 'scit'),
      s(70, 'Wilderness Leaders', 3, 'tli'),
    ]
    const { pairs, retired } = pairSessions(cur, prior)
    expect(pairs[1]).toEqual([prior[1], prior[2]])
    // No current TLI row: the prior one stays retired.
    expect(retired).toEqual([prior[3]])
  })

  it('does not teen-match a main session by type', () => {
    const cur = [s(1, 'Session 2', 10)]
    const prior = [s(2, 'Session 3', 9)]
    expect(pairSessions(cur, prior).pairs[0]).toEqual([])
  })
})
