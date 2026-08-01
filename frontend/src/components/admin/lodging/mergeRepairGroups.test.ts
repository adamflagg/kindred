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
    expect(groups[0]?.partyCount).toBe(3)
    expect(groups[0]?.issueIds).toEqual(['a', 'b', 'c'])
  })

  it('keeps genuinely different sets apart', () => {
    const groups = groupIllegalMerges([
      issue({ id: 'a', raw_value: 'Building A 1and2' }),
      issue({ id: 'b', raw_value: 'Building B 3and4' }),
    ])
    expect(groups).toHaveLength(2)
  })

  // Two source fields feed this queue: household-grain `Family Camp Cabin`
  // and person-grain `Reportable Family Camp Cabin`. Aliases are scoped by
  // source_field, so the same cabin string from both is two different
  // repairs, not one -- folding them would apply one shared resolution note
  // to issues staff never reviewed together.
  it('keeps the same raw_value apart when source_field differs', () => {
    const groups = groupIllegalMerges([
      issue({ id: 'a', source_field: 'Family Camp Cabin' }),
      issue({ id: 'b', source_field: 'Reportable Family Camp Cabin' }),
    ])
    expect(groups).toHaveLength(2)
  })

  // Aliases are also scoped by a year window, and replay rebuilds a
  // year-scoped resolution -- the same raw_value in two years is not
  // necessarily the same fix.
  it('keeps the same raw_value apart when year differs', () => {
    const groups = groupIllegalMerges([
      issue({ id: 'a', year: 2025 }),
      issue({ id: 'b', year: 2026 }),
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
