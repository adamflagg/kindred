import { describe, expect, it } from 'vitest'
import { groupIllegalMerges } from './mergeRepairGroups'
import type { LodgingIngestIssueRecord } from '../../../types/lodging'

function issue(over: Partial<LodgingIngestIssueRecord>): LodgingIngestIssueRecord {
  return {
    id: 'i1',
    kind: 'illegal_merge',
    raw_value: 'Some Building 1and2',
    household_cm_id: 1,
    person_cm_id: 0,
    year: 2026,
    is_resolved: false,
    occurrences: 1,
    source_field: 'Family Camp Cabin',
    resolved_alias: '',
    resolution_note: '',
    ...over,
  } as LodgingIngestIssueRecord
}

describe('groupIllegalMerges', () => {
  // The dedup key is per household, so one broken set across 12 households is
  // 12 rows and `occurrences` does not collapse them. Grouping is what stops
  // staff facing twelve identical rows.
  it('collapses one broken set across many households into a single group', () => {
    const rows = [
      issue({ id: 'a', household_cm_id: 1 }),
      issue({ id: 'b', household_cm_id: 2 }),
      issue({ id: 'c', household_cm_id: 3 }),
    ]
    const groups = groupIllegalMerges(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.householdCount).toBe(3)
    expect(groups[0]?.issueIds).toEqual(['a', 'b', 'c'])
  })

  it('keeps genuinely different sets apart', () => {
    const groups = groupIllegalMerges([
      issue({ id: 'a', raw_value: 'Building A 1and2' }),
      issue({ id: 'b', raw_value: 'Building B 3and4' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('ignores rows of other kinds', () => {
    expect(groupIllegalMerges([issue({ kind: 'unresolved_alias' })])).toHaveLength(0)
  })

  it('ignores already-resolved rows', () => {
    expect(groupIllegalMerges([issue({ is_resolved: true })])).toHaveLength(0)
  })
})
