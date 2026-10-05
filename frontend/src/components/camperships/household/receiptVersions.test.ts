import { describe, expect, it } from 'vitest'

import { TRACE_CAPPED_BY_ASK, TRACE_ROUND1_LOCKED, traceStep } from '../kit/fixtures'
import type { AidTraceStep } from '../kit/receiptModel'
import { receiptOut } from './householdFixtures'
import { diffMarks, receiptVersions, versionCompareWords } from './receiptVersions'

/** TRACE_CAPPED_BY_ASK with some steps' values replaced (by key). */
function withValues(
  trace: readonly AidTraceStep[],
  values: Record<string, string | number>
): AidTraceStep[] {
  return trace.map((step) => (step.key in values ? { ...step, value: values[step.key]! } : step))
}

const LOCKED_R1 = receiptOut(1, {
  kind: 'locked',
  locked_on: '2027-03-09',
  lock_source: 'tick',
  ticked_by_name: 'Test User',
})

describe('receiptVersions: one per posted round, then the live one (round 3, section 1 (B))', () => {
  it('names each posted round "Round N as posted", dated, and the live receipt "Current"', () => {
    const versions = receiptVersions([receiptOut(2), LOCKED_R1])
    expect(versions.map((v) => v.name)).toEqual(['Round 1 as posted', 'Current'])
    expect(versions.map((v) => v.date)).toEqual(['Mar 9', 'live'])
    expect(versions.map((v) => v.total)).toEqual(['$1,500', '$1,500'])
  })

  it('shows the live receipt once when several unposted rounds share it, the latest round its source (M8)', () => {
    const versions = receiptVersions([
      LOCKED_R1,
      receiptOut(2),
      receiptOut(3, { decided_by_name: 'Jordan Rivera' }),
    ])
    expect(versions).toHaveLength(2)
    expect(versions[1]!.receipt.round).toBe(3)
  })

  it('keeps every posted round when nothing is live, oldest first', () => {
    const versions = receiptVersions([
      receiptOut(2, { kind: 'locked', locked_on: '2027-04-22' }),
      LOCKED_R1,
    ])
    expect(versions.map((v) => v.name)).toEqual(['Round 1 as posted', 'Round 2 as posted'])
  })

  it('calls a reproduced receipt reproduced, in its own season (M5, M18)', () => {
    const [first] = receiptVersions([receiptOut(1, { kind: 'reproduced', season: 2025 })])
    expect(first!.name).toBe('Round 1 as reproduced from the 2025 sheet')
    expect(first!.date).toBeNull()
  })

  it('has no versions without a receipt', () => {
    expect(receiptVersions([])).toEqual([])
  })
})

describe('diffMarks: a version against the one before it, matched by step key', () => {
  it('marks nothing on the first version', () => {
    const marks = diffMarks(null, TRACE_CAPPED_BY_ASK)
    expect([...marks.values()].every((m) => m.mark === 'same')).toBe(true)
    expect(marks.size).toBe(TRACE_CAPPED_BY_ASK.length)
  })

  it('marks a changed value with what it was, and leaves an unchanged one alone', () => {
    const now = withValues(TRACE_CAPPED_BY_ASK, { adjusted_income: '90000.00' })
    const marks = diffMarks(TRACE_CAPPED_BY_ASK, now)
    expect(marks.get('adjusted_income')).toEqual({ mark: 'changed', was: '$120,000' })
    expect(marks.get('cost')).toEqual({ mark: 'same', was: null })
  })

  it('matches lines by key, not position', () => {
    const reordered = [...TRACE_CAPPED_BY_ASK].reverse()
    const marks = diffMarks(TRACE_CAPPED_BY_ASK, reordered)
    expect([...marks.values()].every((m) => m.mark === 'same')).toBe(true)
  })

  it('marks a line that first appears as new, and one that went away as gone', () => {
    const r2 = traceStep('r2', 'Round 2 award', '600.00', { appeal: '600.00' }, 'appeal')
    const now = [...TRACE_CAPPED_BY_ASK.filter((s) => s.key !== 'grants'), r2]
    const marks = diffMarks(TRACE_CAPPED_BY_ASK, now)
    expect(marks.get('r2')).toEqual({ mark: 'new', was: null })
    expect(marks.get('grants')).toEqual({ mark: 'gone', was: '$0' })
  })

  it("does not call a lock line new when it carries the earlier version's award", () => {
    const marks = diffMarks(
      withValues(TRACE_CAPPED_BY_ASK, { r1: '1800.00' }),
      withValues(TRACE_ROUND1_LOCKED, { r1: '1500.00' })
    )
    expect(marks.get('r1_locked')).toEqual({ mark: 'same', was: null })
  })

  it("mutes a posted round's worked-out lines: what was posted is what counts", () => {
    const later = withValues(TRACE_ROUND1_LOCKED, { r1_pct: '0.5', r1_potential: '2500.00' })
    const marks = diffMarks(TRACE_CAPPED_BY_ASK, later)
    expect(marks.get('r1_pct')).toEqual({ mark: 'superseded', was: null })
    expect(marks.get('r1_potential')).toEqual({ mark: 'superseded', was: null })
    expect(marks.get('r1')).toEqual({ mark: 'superseded', was: null })
  })
})

describe('versionCompareWords', () => {
  it('counts what changed against the version before', () => {
    const now = withValues(TRACE_CAPPED_BY_ASK, { adjusted_income: '90000.00', income_tier: 4 })
    const r2 = traceStep('r2', 'Round 2 award', '600.00', {}, 'appeal')
    const marks = diffMarks(TRACE_CAPPED_BY_ASK, [...now, r2])
    expect(versionCompareWords(marks)).toBe('2 changed, 1 new')
  })

  it('says when nothing changed, and names a line that went away', () => {
    expect(versionCompareWords(diffMarks(TRACE_CAPPED_BY_ASK, TRACE_CAPPED_BY_ASK))).toBe(
      'nothing changed'
    )
    const marks = diffMarks(
      TRACE_CAPPED_BY_ASK,
      TRACE_CAPPED_BY_ASK.filter((s) => s.key !== 'grants')
    )
    expect(versionCompareWords(marks)).toBe('1 gone')
  })
})
