/** Shared disposition/status/confidence badge color classes.
 *
 * Extracted from PipelineBatchList.tsx for reuse across
 * RequestReviewPanel and other components.
 */

// Confidence thresholds (must match backend config)
export const CONFIDENCE_AUTO_ACCEPT = 0.95
export const CONFIDENCE_RESOLVED = 0.85
export const CONFIDENCE_WARNING = 0.7

const BADGE_COLORS = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  neutral: 'bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300',
} as const

export const RESOLVED_REASONS = new Set([
  'exact_match',
  'reciprocal_match',
  'high_confidence_match',
  'auto_resolved',
  'cross_session_satisfied',
  'directional_preference',
])

export const PENDING_REASONS = new Set([
  'needs_review',
  'target_waitlisted',
  'undirected_preference',
  'self_referential',
  'enrollment_change',
])

/**
 * Declined disposition reasons emitted by the pipeline rules engine
 * (`bunking/sync/bunk_request_processor/disposition/disposition_rules.py`) or
 * by Phase C enrollment reconciliation (`orchestrator/target_enrollment_reconcile.py`).
 *
 * Manual UI declines (RequestReviewPanel, AllCamperRequestsModal) intentionally
 * write `status: 'declined'` with **no** `disposition_reason`. The pipeline has
 * no opinion to record on a staff-initiated decline, and overloading the field
 * with a `staff_manual`-style sentinel would either lose the prior pipeline
 * reason (overwrite) or only partially populate (only-when-empty), neither of
 * which yields an accurate "staff-touched" signal. If that signal is ever
 * needed, add a dedicated `reviewed_by`/`reviewed_at` field instead. Empty
 * `disposition_reason` on a declined row is the correct shape for manual UI
 * declines (issue #1368, closed 2026-05-13).
 */
export const DECLINED_REASONS = new Set([
  'session_mismatch',
  'target_not_attending',
  'target_not_enrolled',
  'requester_not_attending',
])

/** Get Tailwind classes for a disposition reason badge. */
export function getDispositionClasses(reason: string): string {
  if (RESOLVED_REASONS.has(reason)) return BADGE_COLORS.success
  if (PENDING_REASONS.has(reason)) return BADGE_COLORS.warning
  if (DECLINED_REASONS.has(reason)) return BADGE_COLORS.danger
  return BADGE_COLORS.neutral
}

/** Get Tailwind classes for a status badge. Case-insensitive. */
export function getStatusClasses(status: string): string {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
      return BADGE_COLORS.success
    case 'PENDING':
      return BADGE_COLORS.warning
    case 'DECLINED':
      return BADGE_COLORS.danger
    default:
      return BADGE_COLORS.neutral
  }
}

/** Get Tailwind classes for a confidence value badge. */
export function getConfidenceClasses(confidence: number): string {
  if (confidence >= CONFIDENCE_RESOLVED) return BADGE_COLORS.success
  if (confidence >= CONFIDENCE_WARNING) return BADGE_COLORS.warning
  return BADGE_COLORS.danger
}

/** Tailwind classes for the "mutual" reciprocal badge. */
export const MUTUAL_BADGE_CLASSES =
  'bg-forest-100 dark:bg-forest-900/50 text-forest-700 dark:text-forest-300 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium'

/** Tailwind classes for the "Current request" badge shown on the currently expanded row in the camper-requests panel. */
export const CURRENT_REQUEST_BADGE_CLASSES =
  'bg-primary/15 text-primary flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium'

/** Friendly display names for disposition reasons. */
const DISPOSITION_DISPLAY_NAMES: Record<string, string> = {
  // Resolved
  exact_match: 'Matched',
  high_confidence_match: 'Matched',
  auto_resolved: 'Matched',
  reciprocal_match: 'Mutual match',
  cross_session_satisfied: 'Different sessions (neg)',
  directional_preference: 'Age preference',
  // Pending
  needs_review: 'Needs review',
  target_waitlisted: 'Waitlisted',
  undirected_preference: 'Unclear age preference',
  self_referential: 'Self-reference — review',
  enrollment_change: 'Enrollment changed — review',
  // Declined
  session_mismatch: 'Different sessions',
  target_not_attending: 'Not attending',
  target_not_enrolled: 'Not enrolled',
  requester_not_attending: 'Requester not attending',
}

/** Format a disposition reason for display using friendly names. */
export function formatDispositionReason(reason: string): string {
  return DISPOSITION_DISPLAY_NAMES[reason] ?? reason.replace(/_/g, ' ')
}

/** Sort rank for disposition reasons: declined (0) < pending (1) < resolved (2) < unknown (3). */
export function getDispositionSortRank(reason: string): number {
  if (DECLINED_REASONS.has(reason)) return 0
  if (PENDING_REASONS.has(reason)) return 1
  if (RESOLVED_REASONS.has(reason)) return 2
  return 3
}

/** Alias of `formatDispositionReason` used by the new Status-cell reason line. */
export const formatReason = formatDispositionReason

/**
 * Whether the Status cell should render a reason line under the chip.
 *
 * - Resolved rows: never (chip alone; mutual-match badge lives elsewhere).
 * - Declined rows: only for canonical pipeline-declined reasons
 *   (DECLINED_REASONS). Manual UI declines leave the prior pipeline reason in
 *   place (intentional per #1368), so the field is often a stale resolved- or
 *   pending-family value — rendering it alongside "Declined" produces a
 *   contradictory display ("Declined · Matched"). Symmetric with the pending
 *   branch below. The all-camper audit modal renders full history via its own
 *   code path, unaffected by this predicate (issue #1447).
 * - Pending rows: only for triage reasons (needs_review, target_waitlisted,
 *   undirected_preference, self_referential). Other pending rows stay chip-only.
 */
export function shouldShowReasonInStatus(
  status: string,
  reason: string | null | undefined
): boolean {
  if (!reason) return false
  const normalized = status.toLowerCase()
  if (normalized === 'resolved') return false
  if (normalized === 'declined') return DECLINED_REASONS.has(reason)
  if (normalized === 'pending') return PENDING_REASONS.has(reason)
  return false
}
