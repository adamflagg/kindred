/**
 * Shared classification for post-check Issue objects.
 *
 * Used by both PostValidationResultsModal (renders the in-app UI) and
 * BunkPlanReport (PDF export). Keeping the sets/regex in one file
 * avoids drift between the two surfaces.
 */
export const BUNK_LEVEL_ISSUE_TYPES = new Set([
  'capacity_violation',
  'age_spread_warning',
  'grade_ratio_warning',
  'grade_spread_warning',
  'grade_adjacency_warning',
  'age_flow_inversion',
  'isolation_risk',
])

export const SUPPRESSED_ISSUE_TYPES = new Set([
  'valid_negative_request_violated',
  'no_requests',
  'valid_request_unsatisfied',
  'campers_with_unsatisfied_valid_requests',
])

interface IssueLike {
  type: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Canonical post-check issue shape returned by the validator/API.
 * Imported by PostValidationResultsModal, BunkPlanReport, and LazyPdfExportButton
 * so a future field (e.g. `affected_ids`) only needs to land in one place.
 */
export interface PostCheckIssue {
  type: string
  severity: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Returns the bunk name associated with an issue.
 *
 * Prefers `issue.details.bunk_name` (emitted structurally by the validator
 * for every bunk-level type). Falls back to format-specific regex parsing of
 * `issue.message` for older payloads or unexpected shapes.
 */
export type Section = 'families' | 'cabins' | 'hidden'
export type Severity = 'red' | 'amber'

/**
 * Issue[] type → which action section it renders in.
 *
 * The 'cabins' set must stay equal to BUNK_LEVEL_ISSUE_TYPES so the headline
 * cabin count (derived from ISSUE_SECTION==='cabins') matches the rows actually
 * rendered in the "Cabins to review" section (derived from BUNK_LEVEL_ISSUE_TYPES).
 * `unassigned_camper` is intentionally NOT here: it is surfaced via the modal's
 * dedicated "campers need bunk assignment" block and the "Other issues" catch-all,
 * so listing it as a cabin would count it without showing it (the #1712 bug).
 */
export const ISSUE_SECTION: Record<string, Section> = {
  capacity_violation: 'cabins',
  age_spread_warning: 'cabins',
  grade_ratio_warning: 'cabins',
  grade_spread_warning: 'cabins',
  grade_adjacency_warning: 'cabins',
  age_flow_inversion: 'cabins',
  isolation_risk: 'cabins',
  no_requests: 'hidden',
  valid_request_unsatisfied: 'hidden',
  valid_negative_request_violated: 'hidden',
  campers_with_unsatisfied_valid_requests: 'hidden',
}

/** Issue[] type → severity. Over-capacity is serious; the rest are FYI nits. */
export const ISSUE_SEVERITY: Record<string, Severity> = {
  capacity_violation: 'red',
  age_spread_warning: 'amber',
  grade_ratio_warning: 'amber',
  grade_spread_warning: 'amber',
  grade_adjacency_warning: 'amber',
  age_flow_inversion: 'amber',
  isolation_risk: 'amber',
}

/** Family-cohort → severity. All cohorts are real misses → worth a call. Keyed by FamilyCohort string. */
export const COHORT_SEVERITY: Record<string, Severity> = {
  got_nothing: 'red',
  sacrificed_mp: 'red',
  violated: 'red',
  priority_unmet: 'red',
  impossible_request: 'red', // overridden per-reason at render via REASON_SEVERITY
}

export function extractBunkName(issue: IssueLike): string {
  const structured = issue.details?.['bunk_name']
  if (typeof structured === 'string' && structured.length > 0) return structured

  // Fallback: parse the message. Each bunk-level message format has a known
  // anchor — match the most specific patterns first.
  const patterns: RegExp[] = [
    /^Bunk\s+(.+?)\s+(?:is|has)\s/, // capacity_violation, grade_*, age_spread_warning
    /^(.+?)\s+\(avg age\s/, // age_flow_inversion
    /^(.+?)\s+has\s+\d+\s+connected\s/, // isolation_risk
  ]
  for (const pattern of patterns) {
    const match = issue.message.match(pattern)
    if (match?.[1]) return match[1]
  }
  return 'Unknown'
}
