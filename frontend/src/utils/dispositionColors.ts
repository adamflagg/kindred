/** Shared disposition/status/confidence badge color classes.
 *
 * Extracted from PipelineBatchList.tsx for reuse across
 * RequestReviewPanel and other components.
 */

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
])

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
  if (confidence >= 0.85) return BADGE_COLORS.success
  if (confidence >= 0.7) return BADGE_COLORS.warning
  return BADGE_COLORS.danger
}
