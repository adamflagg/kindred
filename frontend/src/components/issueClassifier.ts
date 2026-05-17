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
