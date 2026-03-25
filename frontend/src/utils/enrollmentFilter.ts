/**
 * Utilities for filtering attendees by enrollment status.
 *
 * Core logic: show enrolled sessions; if none exist for a year,
 * fall back to the single most relevant non-enrolled status.
 */

import type { Camper } from '../types/app-types'

/** Priority order for picking the "best" non-enrolled status (lower = better) */
const STATUS_PRIORITY: Record<string, number> = {
  waitlisted: 1,
  applied: 2,
  cancelled: 3,
  withdrawn: 4,
  left_early: 5,
  dismissed: 6,
  incomplete: 7,
  inquiry: 8,
  none: 9,
}

/** Compact single-letter indicator for non-enrolled statuses */
interface StatusIndicator {
  letter: string
  colorClass: string
}

const STATUS_INDICATORS: Record<string, StatusIndicator> = {
  waitlisted: {
    letter: 'W',
    colorClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  applied: {
    letter: 'A',
    colorClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  cancelled: {
    letter: 'C',
    colorClass: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  withdrawn: {
    letter: 'X',
    colorClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  dismissed: {
    letter: 'D',
    colorClass: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  left_early: {
    letter: 'L',
    colorClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
  incomplete: {
    letter: 'I',
    colorClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  inquiry: {
    letter: '?',
    colorClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
}

/**
 * Get compact status indicator for a non-enrolled status.
 * Returns null for enrolled or unknown statuses.
 */
export function getStatusIndicator(status: string | undefined): StatusIndicator | null {
  if (!status || status === 'enrolled') return null
  return STATUS_INDICATORS[status] ?? null
}

/**
 * Get the priority of a status for picking the "best" fallback.
 * Lower number = higher priority.
 */
export function getStatusPriority(status: string | undefined): number {
  return STATUS_PRIORITY[status ?? ''] ?? 999
}

export interface FilteredEnrollment {
  /** Only actually enrolled campers */
  enrolled: Camper[]
  /** If no enrolled campers, the single best non-enrolled camper */
  fallback: Camper | null
}

/**
 * Filter attendees by enrollment status.
 *
 * Returns enrolled campers only. If none are enrolled,
 * picks the single most relevant non-enrolled camper
 * (by status priority: waitlisted > applied > cancelled > ...).
 */
export function filterEnrollmentsByStatus(allAttendees: Camper[]): FilteredEnrollment {
  const enrolled = allAttendees.filter((c) => c.attendee_status === 'enrolled')

  if (enrolled.length > 0) {
    return { enrolled, fallback: null }
  }

  // No enrolled — pick best non-enrolled by status priority
  if (allAttendees.length === 0) {
    return { enrolled: [], fallback: null }
  }

  const sorted = [...allAttendees].sort(
    (a, b) => getStatusPriority(a.attendee_status) - getStatusPriority(b.attendee_status)
  )

  return { enrolled: [], fallback: sorted[0] ?? null }
}
