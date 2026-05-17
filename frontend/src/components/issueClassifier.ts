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

/**
 * Best-effort bunk name extraction from validator-emitted message strings.
 * Validator messages start with "<BunkName> ..." today; if that ever changes,
 * the validator should emit a structured `bunk_name` field instead.
 */
export function extractBunkName(issueMessage: string): string {
  const match = issueMessage.match(/^(\S+(?:\s+\S+)?)\s/)
  return match?.[1] ?? 'Unknown'
}
