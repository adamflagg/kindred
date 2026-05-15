// Per-reason hint copy: tells staff what to actually do for each rejection.
// Shared across PreValidationResultsModal + PostValidationResultsModal so both
// modals speak the same language about a given impossibility code.

export const REASON_HINTS: Record<string, string> = {
  target_not_in_solver: 'check enrollment — requested camper not on roster',
  grade_compatibility: 'grade gap too wide — confirm priority with the family',
  cross_session: 'requested friend is in a different session — confirm intent',
  pair_no_shared_bunk: 'cross-gender request — confirm with the family',
  age_pref_no_eligible_grade: 'at the youngest/oldest grade — preference is moot',
  malformed: 'request is missing a name — needs parent resubmission',
  self_conflict: 'contradicting requests — confirm which preference the family meant',
}

export function camperActionHints(reasonCodes: string[]): string {
  const hints = new Set<string>()
  for (const code of reasonCodes) {
    hints.add(REASON_HINTS[code] ?? 'review request')
  }
  return Array.from(hints).join(' / ')
}
