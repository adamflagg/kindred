// frontend/src/utils/computeSlicesFromPredicate.ts
import type { BunkRequest } from '../types/app-types'
import type { SatisfiedRequestInfo, RequestSlice } from '../contexts/BunkRequestContext'

export type SatisfactionPredicate = (req: BunkRequest) => boolean

/**
 * Source-of-truth slice aggregator.
 *
 * Iterates resolved requests once; classifies each by source_field per the
 * Stage 3b.1 truth table; sums totals + satisfied per slice; derives the
 * parent/staff alert flags. Both code paths (scenario-aware and prod-aligned)
 * delegate here, so the source-classification rules live in exactly one place.
 *
 * The bug fixed in Stage 3b.1: the previous `computeSatisfiedRequestInfo`
 * short-circuited on `request_type === 'not_bunk_with'` and routed those rows
 * to `staff`, even when the row was a parent's bunk_with text that the AI had
 * parsed into a not_bunk_with. This function uses source_field-first
 * classification; the `else` catch-all covers staff source fields
 * (`not_bunk_with`, `bunking_notes`, `internal_notes`). By upstream invariant,
 * all rows reaching the catch-all have `req.source === 'staff'`.
 */
export function computeSlicesFromPredicate(
  personRequests: BunkRequest[],
  isSatisfied: SatisfactionPredicate
): SatisfiedRequestInfo {
  let materialTotal = 0
  let materialSat = 0
  let bestTotal = 0
  let bestSat = 0
  let staffTotal = 0
  let staffSat = 0

  for (const req of personRequests) {
    // §15.1 resolved-only boundary
    if (req.status !== 'resolved') continue
    const sat = isSatisfied(req)

    if (req.source_field === 'bunk_with') {
      materialTotal++
      if (sat) materialSat++
    } else if (req.source_field === 'socialize_with') {
      bestTotal++
      if (sat) bestSat++
    } else if (req.source === 'staff') {
      // Catches: not_bunk_with / bunking_notes / internal_notes / any future
      // staff source_field. This guard rejects malformed legacy rows (e.g.
      // bunk_with × null source_field × family source) rather than silently
      // bucketing them as staff — they fall through and are not counted.
      // Regression lock: `bunk_with × null × family → not binned` test case.
      staffTotal++
      if (sat) staffSat++
    }
  }

  const slice = (total: number, satisfied: number): RequestSlice => ({
    total,
    satisfied,
    satisfactionRate: total === 0 ? 0 : satisfied / total,
  })

  return {
    materialParent: slice(materialTotal, materialSat),
    bestEffortParent: slice(bestTotal, bestSat),
    staff: slice(staffTotal, staffSat),
    parentMinOneViolation: materialTotal >= 1 && materialSat === 0,
    staffUnsatisfiedAlert: staffTotal >= 1 && staffSat === 0,
  }
}
