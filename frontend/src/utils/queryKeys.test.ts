/**
 * Contract tests for `queryKeys.ts` factories.
 *
 * - Pins the `originalBunkRequestsByRequesterCmId` factory shape. A sibling
 *   `originalBunkRequestsByPersonId` factory previously existed for a
 *   `person_id =` filter that doesn't exist on `original_bunk_requests`; PR
 *   #1338 removed the only caller and the audit (#1339) removed the dead
 *   factory itself.
 * - Pins the `year` argument on `camperHistory` so filtering by year does
 *   not reuse a cache slot keyed only by personId.
 */

import { describe, it, expect } from 'vitest'
import { queryKeys } from './queryKeys'

describe('queryKeys.originalBunkRequestsByRequesterCmId', () => {
  it('key includes a requester-cm-id discriminator', () => {
    const key = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    expect(key[0]).toBe('original-bunk-requests-by-requester-cm-id')
    expect(key).toContain(12345)
    expect(key).toContain(2025)
  })

  it('handles undefined ids without colliding with the populated case', () => {
    const populated = queryKeys.originalBunkRequestsByRequesterCmId(12345, 2025)
    const empty = queryKeys.originalBunkRequestsByRequesterCmId(undefined, 2025)
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

describe('queryKeys.solverRuns / solverRunsPrefix', () => {
  it('exposes both factories on the queryKeys object (centralization rule)', () => {
    expect(typeof queryKeys.solverRunsPrefix).toBe('function')
    expect(typeof queryKeys.solverRuns).toBe('function')
  })

  it('solverRuns key starts with the same prefix as solverRunsPrefix', () => {
    const prefix = queryKeys.solverRunsPrefix()
    const key = queryKeys.solverRuns({ hideFailed: true })
    expect(key.slice(0, prefix.length)).toEqual(prefix)
  })

  it('different filters produce different keys', () => {
    const a = queryKeys.solverRuns({ hideFailed: true })
    const b = queryKeys.solverRuns({ hideFailed: false })
    expect(a).not.toEqual(b)
  })
})

describe('queryKeys.scenariosList', () => {
  it('exposes the factory on the queryKeys object', () => {
    expect(typeof queryKeys.scenariosList).toBe('function')
  })

  it('includes year so year switches do not collide', () => {
    const a = queryKeys.scenariosList(2025)
    const b = queryKeys.scenariosList(2026)
    expect(a).not.toEqual(b)
  })
})

describe('queryKeys.allSessionsList', () => {
  it('includes year so year switches do not collide', () => {
    const a = queryKeys.allSessionsList(2025)
    const b = queryKeys.allSessionsList(2026)
    expect(a).not.toEqual(b)
  })
})
