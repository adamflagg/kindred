/**
 * Contract tests for `queryKeys.ts` factories.
 *
 * - Pins the split between `originalBunkRequestsByPersonId` and
 *   `originalBunkRequestsByRequesterCmId` — two callers wrote to the same
 *   factory but produced different shapes from different filters, causing a
 *   cache collision. The factories MUST produce non-colliding keys.
 * - Pins the `year` argument on `camperHistory` so filtering by year does
 *   not reuse a cache slot keyed only by personId.
 */

import { describe, it, expect } from 'vitest'
import { queryKeys } from './queryKeys'

describe('queryKeys.originalBunkRequestsByPersonId vs originalBunkRequestsByRequesterCmId', () => {
  it('produces distinct cache keys for the two callers', () => {
    // Same numeric id, same year — different shapes (different filter columns)
    // must not collide in the cache.
    const personIdKey = queryKeys.originalBunkRequestsByPersonId(12345, 2025)
    const cmIdKey = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    expect(personIdKey).not.toEqual(cmIdKey)
  })

  it('originalBunkRequestsByPersonId key includes a person-id discriminator', () => {
    const key = queryKeys.originalBunkRequestsByPersonId(12345, 2025)
    expect(key[0]).toBe('original-bunk-requests-by-person-id')
    expect(key).toContain(12345)
    expect(key).toContain(2025)
  })

  it('originalBunkRequestsByRequesterCmId key includes a requester-cm-id discriminator', () => {
    const key = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    expect(key[0]).toBe('original-bunk-requests-by-requester-cm-id')
    expect(key).toContain(12345)
    expect(key).toContain(2025)
  })

  it('handles undefined ids without colliding with the populated case', () => {
    const populated = queryKeys.originalBunkRequestsByPersonId(12345, 2025)
    const empty = queryKeys.originalBunkRequestsByPersonId(undefined, 2025)
    expect(populated).not.toEqual(empty)
  })
})

describe('queryKeys.camperHistory', () => {
  it('includes year in the key so per-year filters do not collide', () => {
    const a = queryKeys.camperHistory('p-1', 2024)
    const b = queryKeys.camperHistory('p-1', 2025)
    expect(a).not.toEqual(b)
  })

  it('key contains both personId and year', () => {
    const key = queryKeys.camperHistory('p-1', 2025)
    expect(key).toContain('p-1')
    expect(key).toContain(2025)
  })
})

describe('queryKeys.camperSiblingsPanel', () => {
  it('accepts a number householdId and produces a key with it', () => {
    const key = queryKeys.camperSiblingsPanel(42, 'p-1', 2025)
    expect(key).toContain(42)
    expect(key).toContain('p-1')
    expect(key).toContain(2025)
  })

  it('accepts undefined householdId without throwing', () => {
    expect(() => queryKeys.camperSiblingsPanel(undefined, 'p-1', 2025)).not.toThrow()
  })
})
