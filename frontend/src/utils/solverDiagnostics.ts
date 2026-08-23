import type { SolverDiagnostics, StaffNbwYieldRaw } from '../services/solver'
import type { ResolvedStaffSeparationYield } from '../components/SolverProgressModal'

/** #1638 — resolve raw staff-NBW yields (cm_ids) to display names via the session roster. */
export function resolveYields(
  raw: StaffNbwYieldRaw[] | undefined,
  nameById: Map<number, string>
): ResolvedStaffSeparationYield[] {
  if (!raw) return []
  const nameOf = (cm: number) => nameById.get(cm) ?? String(cm)
  return raw.map((y) => ({
    subjectName: nameOf(y.subject_cm),
    targetName: nameOf(y.target_cm),
    protectedCamperName: nameOf(y.protected_camper_cm),
  }))
}

/**
 * #1638 — does this diagnostics payload have anything worth opening the modal for?
 *
 * A TYPE PREDICATE, because `undefined` can never be reviewable: the caller
 * that opens the dialog on a `true` result has to hand it a payload, and
 * narrowing here is what saves it from a `?? null` that would silently gate
 * the dialog off (kindred#2541).
 */
export function hasReviewableDiagnostics(d: SolverDiagnostics | undefined): d is SolverDiagnostics {
  if (!d) return false
  return (
    Boolean(d.infeasibilityCause) ||
    (d.localization?.campers.length ?? 0) > 0 ||
    (d.impossibilityReport?.flat.length ?? 0) > 0
  )
}
