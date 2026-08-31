/**
 * The one place both weekend surfaces read housing freshness from.
 *
 * The tests that matter about the RULE — unscoped covers everyone, a press on
 * another weekend does not — live on the API side now (kindred#2617), because
 * that is where the rule is applied against `sync_runs` history. What is left
 * here is the coercion, and it is not decoration: `""` is what the payload
 * carries for "no attributable time", and `new Date('')` is an Invalid Date
 * that `formatDistanceToNow` renders as "Invalid Date ago".
 */
import { describe, expect, it } from 'vitest'

import { weekendHousingSyncedAt } from './weekendFreshness'

describe('weekendHousingSyncedAt', () => {
  it("returns the weekend's own timestamp", () => {
    expect(weekendHousingSyncedAt({ housing_synced_at: '2026-04-22T12:00:00.000Z' })).toBe(
      '2026-04-22T12:00:00.000Z'
    )
  })

  it('reads the withheld "" as undefined, not as a date', () => {
    expect(weekendHousingSyncedAt({ housing_synced_at: '' })).toBeUndefined()
  })

  it('reads an absent field as undefined', () => {
    expect(weekendHousingSyncedAt({})).toBeUndefined()
  })

  it('reads an unresolved weekend as undefined', () => {
    expect(weekendHousingSyncedAt(undefined)).toBeUndefined()
  })
})
