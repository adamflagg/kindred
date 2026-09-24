import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { familyShareRuns } from './shareMarkRuns'

const party = (overrides: Partial<RosterPartyRow> = {}): RosterPartyRow => ({
  grain: 'household',
  household_cm_id: 1000001,
  display_name: 'Johnson',
  ...overrides,
})

describe('familyShareRuns', () => {
  it('is the anchor then the cluster, the anchor hot only on yes', () => {
    const runs = familyShareRuns(party({ share: { preference: 'yes_share', proximity: ['near'] } }))
    expect(runs.map((r) => r.key)).toEqual(['anchor', 'cluster'])
    expect(runs[0]?.hot).toBe(true)
    // NEAR alone never makes the capsule hot (shareEmphasis rule).
    expect(runs[1]?.hot).toBe(false)
    expect(runs[1]?.testId).toBe('share-cluster')
  })

  it('is empty for a person-grain party', () => {
    expect(familyShareRuns(party({ grain: 'person', person_cm_id: 1000004 }))).toEqual([])
  })
})
