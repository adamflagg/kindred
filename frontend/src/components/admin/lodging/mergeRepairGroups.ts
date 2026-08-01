/**
 * Groups illegal-merge work-queue rows by the unit set they are blocked on.
 *
 * The queue dedups on
 * (year, kind, raw_value, source_field, household_cm_id, person_cm_id) --
 * per PARTY (a household on `Family Camp Cabin`, a person on `Reportable
 * Family Camp Cabin`). So one broken set affecting twelve parties is twelve
 * rows, and `occurrences` will not collapse them. Grouping here is what makes
 * the repair one action instead of twelve.
 */
import type { LodgingIngestIssueRecord } from '../../../types/lodging'

export interface MergeRepairGroup {
  key: string
  rawValues: string[]
  /** Populated by Task 7 from the alias record, not by this module. */
  memberUnitIds: string[]
  /** Populated by Task 7 from the verdict, not by this module. */
  missingUnitIds: string[]
  issueIds: string[]
  /** Counts rows of BOTH grains — household (family camp) and person (adult weekend). */
  partyCount: number
}

export function groupIllegalMerges(rows: LodgingIngestIssueRecord[]): MergeRepairGroup[] {
  const byKey = new Map<string, MergeRepairGroup>()

  for (const row of rows) {
    if (row.kind !== 'illegal_merge' || row.is_resolved) continue

    // Grouping key is (year, source_field, raw_value) -- everything the
    // backend dedup key has EXCEPT the party columns (household_cm_id,
    // person_cm_id), which is exactly what we want to collapse across.
    // `year` and `source_field` stay in the key: the same cabin string can
    // arrive from two source fields (household-grain `Family Camp Cabin` vs.
    // person-grain `Reportable Family Camp Cabin`) or two years, and those
    // are genuinely different repairs -- aliases themselves are scoped by
    // source_field and a year window, so folding across them would apply one
    // shared resolution note to issues staff never reviewed together.
    const key = `${row.year}:${row.source_field}:${row.raw_value}`
    const existing = byKey.get(key)
    if (existing) {
      existing.issueIds.push(row.id)
      existing.partyCount += 1
      continue
    }
    byKey.set(key, {
      key,
      rawValues: [row.raw_value],
      memberUnitIds: [],
      missingUnitIds: [],
      issueIds: [row.id],
      partyCount: 1,
    })
  }

  return [...byKey.values()]
}
