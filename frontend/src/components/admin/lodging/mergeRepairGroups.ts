/**
 * Groups illegal-merge work-queue rows by the unit set they are blocked on.
 *
 * The queue dedups on
 * (year, kind, raw_value, source_field, household_cm_id, person_cm_id) --
 * per HOUSEHOLD. So one broken set affecting twelve households is twelve
 * rows, and `occurrences` will not collapse them. Grouping here is what makes
 * the repair one action instead of twelve.
 */
import type { LodgingIngestIssueRecord } from '../../../types/lodging'

export interface MergeRepairGroup {
  key: string
  rawValues: string[]
  memberUnitIds: string[]
  missingUnitIds: string[]
  issueIds: string[]
  householdCount: number
}

export function groupIllegalMerges(rows: LodgingIngestIssueRecord[]): MergeRepairGroup[] {
  const byKey = new Map<string, MergeRepairGroup>()

  for (const row of rows) {
    if (row.kind !== 'illegal_merge' || row.is_resolved) continue

    // raw_value is the grouping key: it is what the alias resolves FROM, so
    // two rows sharing it are blocked on the same set by construction.
    const key = row.raw_value
    const existing = byKey.get(key)
    if (existing) {
      existing.issueIds.push(row.id)
      existing.householdCount += 1
      continue
    }
    byKey.set(key, {
      key,
      rawValues: [row.raw_value],
      memberUnitIds: [],
      missingUnitIds: [],
      issueIds: [row.id],
      householdCount: 1,
    })
  }

  return [...byKey.values()]
}
