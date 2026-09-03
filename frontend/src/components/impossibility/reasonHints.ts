// Reason-code copy for impossibility modals.
//
// Two parallel views on the same set of codes:
//   - REASON_HINTS — action copy ("what should staff do?")
//   - FRIENDLY_REASON_LABELS — short noun phrase ("what is this?") for chips
//
// Typed against the shared ReasonCode union so adding a new code in one map
// without the other is a compile error — the gap that 931045ca's self_conflict
// fix patched at runtime.

export type ReasonCode =
  | 'target_not_in_solver'
  | 'grade_compatibility'
  | 'cross_session'
  | 'pair_no_shared_bunk'
  | 'age_pref_no_eligible_grade'
  | 'malformed'
  | 'self_conflict'

export const REASON_HINTS: Record<ReasonCode, string> = {
  target_not_in_solver: 'check enrollment — requested camper not on roster',
  grade_compatibility: 'grade gap too wide — confirm priority with the family',
  cross_session: 'requested friend is in a different session — confirm intent',
  pair_no_shared_bunk: 'cross-gender request — confirm with the family',
  age_pref_no_eligible_grade: 'no peers in the requested direction — preference may not be met',
  malformed: 'request is missing a name — needs parent resubmission',
  self_conflict: 'contradicting requests — confirm which preference the family meant',
}

export const FRIENDLY_REASON_LABELS: Record<ReasonCode, string> = {
  target_not_in_solver: 'Friend not enrolled',
  grade_compatibility: 'Grade range too wide',
  cross_session: 'Different sessions',
  pair_no_shared_bunk: "Can't share a cabin",
  age_pref_no_eligible_grade: 'No matching age group available',
  malformed: 'Incomplete request',
  self_conflict: 'Contradicting requests',
}

// Severity for impossibility reasons folded into the post-check.
// Red = the family asked for something that conflicts with how we bunk (worth a call).
// Amber = unfulfillable for data/enrollment reasons (FYI, nothing to do).
export const REASON_SEVERITY: Record<ReasonCode, 'red' | 'amber'> = {
  grade_compatibility: 'red',
  pair_no_shared_bunk: 'red',
  self_conflict: 'red',
  target_not_in_solver: 'amber',
  malformed: 'amber',
  cross_session: 'amber', // auto-declined upstream — rarely reaches post-check
  age_pref_no_eligible_grade: 'amber',
}

// Both lookups below take a `code` that came off the wire as an arbitrary
// string, so the entry genuinely may not exist and the `??` fallbacks are
// load-bearing (pinned by this module's tests).
//
// They used to say `MAP[code as ReasonCode]`, and that cast was the defect:
// it told TypeScript the lookup always succeeds, which made the real fallback
// look like dead code to `no-unnecessary-condition`. Widening the map to a
// partial string-keyed record instead says the true thing -- the lookup can
// miss -- with no cast at all, and the exhaustiveness guarantee on the map
// literals above is untouched. #2669.
type ReasonLookup<T> = Partial<Record<string, T>>

export function friendlyReasonLabel(code: string): string {
  const labels: ReasonLookup<string> = FRIENDLY_REASON_LABELS
  return labels[code] ?? code
}

// Sorted before joining so the same code set always renders identically,
// regardless of the order the backend emits reason_codes.
export function camperActionHints(reasonCodes: string[]): string {
  const hints = new Set<string>()
  for (const code of reasonCodes) {
    const hintsByCode: ReasonLookup<string> = REASON_HINTS
    hints.add(hintsByCode[code] ?? 'review request')
  }
  return Array.from(hints).sort().join(' / ')
}
