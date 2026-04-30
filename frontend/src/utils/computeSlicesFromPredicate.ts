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
  const satisfiedRequests: BunkRequest[] = []

  for (const req of personRequests) {
    // §15.1 resolved-only boundary
    if (req.status !== 'resolved') continue
    const sat = isSatisfied(req)
    if (sat) satisfiedRequests.push(req)

    if (req.source_field === 'bunk_with') {
      materialTotal++
      if (sat) materialSat++
    } else if (req.source_field === 'socialize_with') {
      bestTotal++
      if (sat) bestSat++
    } else if (!req.source_field && req.request_type === 'age_preference') {
      // Legacy fallback (mirrors backend bunking_validator.py:514-516).
      // Tracked for removal: #1086.
      bestTotal++
      if (sat) bestSat++
    } else {
      // socialize_with is handled in the branch above; this catches:
      // not_bunk_with / bunking_notes / internal_notes / any future staff
      // source_field. Upstream invariant: req.source === 'staff'.
      staffTotal++
      if (sat) staffSat++
    }
  }

  const slice = (total: number, satisfied: number): RequestSlice => ({
    total,
    satisfied,
    satisfactionRate: total === 0 ? 0 : satisfied / total,
  })

  // NOTE: topPriority is computed from the UNFILTERED personRequests (any
  // status), while satisfiedRequests holds only resolved+satisfied rows. This
  // preserves Stage 3a's verbatim behavior — see #1090 for follow-up on whether
  // this should be resolved-only.
  const topPriority = personRequests.reduce((m, r) => Math.max(m, r.priority ?? 0), 0)
  const topPrioritySatisfied = satisfiedRequests.some((r) => (r.priority ?? 0) === topPriority)
  const priorityLevels = [...new Set(satisfiedRequests.map((r) => r.priority ?? 0))].sort(
    (a, b) => b - a
  )

  return {
    materialParent: slice(materialTotal, materialSat),
    bestEffortParent: slice(bestTotal, bestSat),
    staff: slice(staffTotal, staffSat),
    parentMinOneViolation: materialTotal >= 1 && materialSat === 0,
    staffUnsatisfiedAlert: staffTotal >= 1 && staffSat === 0,
    topPrioritySatisfied,
    priorityLevels,
  }
}
