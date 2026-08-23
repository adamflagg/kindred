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
 * Returns a plain boolean, NOT a type predicate, and the distinction is load
 * bearing. `d is SolverDiagnostics` is unsound in its FALSE branch: a payload
 * that is present but wholly empty -- all three fields null, which
 * `solverDiagnostics.test.ts` pins as a real case -- returns false, so the
 * else branch would narrow `d` to `undefined` and let a caller reason about a
 * value that exists. The caller gets the narrowing it needs for free from a
 * truthiness conjunct (`result.diagnostics && hasReviewableDiagnostics(...)`),
 * which is what saves it from the `?? null` that would silently gate the
 * dialog off (kindred#2541) without buying the unsound half.
 */
export function hasReviewableDiagnostics(d: SolverDiagnostics | undefined): boolean {
  if (!d) return false
  return (
    Boolean(d.infeasibilityCause) ||
    (d.localization?.campers.length ?? 0) > 0 ||
    (d.impossibilityReport?.flat.length ?? 0) > 0
  )
}
