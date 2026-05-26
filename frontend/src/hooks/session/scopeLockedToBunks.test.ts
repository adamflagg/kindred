/**
 * Tests for scopeLockedToBunks() pure helper (#1609 fix #2 + #6).
 *
 * Verifies:
 *  1. Stale ids (not present in bunks) are dropped from the filtered set.
 *  2. In-scope ids (present in bunks) are kept.
 *  3. Empty locked set → empty result.
 *  4. All stale → empty result.
 *  5. Overflow-gate derivation: overflow is suppressed when filteredLockedCount = 0.
 */
import { describe, it, expect } from 'vitest'
import { scopeLockedToBunks } from './scopeLockedToBunks'

describe('scopeLockedToBunks', () => {
  const bunks = [{ cm_id: 1000001 }, { cm_id: 1000002 }]

  it('keeps ids that are in the bunk list', () => {
    const locked = new Set([1000001, 1000002]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    expect(result.has(1000001)).toBe(true)
    expect(result.has(1000002)).toBe(true)
    expect(result.size).toBe(2)
  })

  it('drops stale ids not in the bunk list', () => {
    // 9999 is from a previous session
    const locked = new Set([1000001, 9999]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    expect(result.has(1000001)).toBe(true)
    expect(result.has(9999)).toBe(false)
    expect(result.size).toBe(1)
  })

  it('returns empty set when locked is empty', () => {
    const locked = new Set<number>() as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    expect(result.size).toBe(0)
  })

  it('returns empty set when all locked ids are stale', () => {
    const locked = new Set([8888, 9999]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    expect(result.size).toBe(0)
  })

  it('returns a new Set instance (does not mutate input)', () => {
    const locked = new Set([1000001]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    expect(result).not.toBe(locked)
  })

  it('overflow-gate: filteredCount > 0 → allowOverflow passes through', () => {
    // Caller pattern: lockedCount > 0 ? allowOverflow : false
    const locked = new Set([1000001]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    const filteredCount = result.size
    const effectiveOverflow = filteredCount > 0 ? true : false
    expect(effectiveOverflow).toBe(true)
  })

  it('overflow-gate: filteredCount = 0 → allowOverflow suppressed to false', () => {
    // All ids are stale → no locks in scope → overflow must be false
    const locked = new Set([9999]) as ReadonlySet<number>
    const result = scopeLockedToBunks(locked, bunks)
    const filteredCount = result.size
    const effectiveOverflow = filteredCount > 0 ? true : false
    expect(effectiveOverflow).toBe(false)
  })
})
