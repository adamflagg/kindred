/**
 * Utilities for filtering attendees by enrollment status.
 *
 * Core logic: show enrolled sessions; if none exist for a year,
 * fall back to the single most relevant non-enrolled status.
 */

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
  unknown: 9,
  none: 10,
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
  unknown: {
    letter: '?',
    colorClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  none: {
    letter: '-',
    colorClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
}

/**
 * Get compact status indicator for a non-enrolled status.
 * Returns null for enrolled or statuses not in the indicator map.
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

export interface FilteredEnrollment<T> {
  /** Only actually enrolled items */
  enrolled: T[]
  /** If no enrolled items, the single best non-enrolled item */
  fallback: T | null
}

/**
 * Filter items by enrollment status.
 *
 * Returns enrolled items only. If none are enrolled,
 * picks the single most relevant non-enrolled item
 * (by status priority: waitlisted > applied > cancelled > ...).
 *
 * Treats undefined/missing status as enrolled (defensive default).
 *
 * @param items - Array of items to filter
 * @param getStatus - Accessor to extract the status string from each item
 */
export function filterEnrollmentsByStatus<T>(
  items: T[],
  getStatus: (item: T) => string | undefined
): FilteredEnrollment<T> {
  const enrolled = items.filter((item) => {
    const status = getStatus(item)
    return !status || status === 'enrolled'
  })

  if (enrolled.length > 0) {
    return { enrolled, fallback: null }
  }

  // No enrolled — pick best non-enrolled by status priority
  if (items.length === 0) {
    return { enrolled: [], fallback: null }
  }

  const sorted = items.toSorted(
    (a, b) => getStatusPriority(getStatus(a)) - getStatusPriority(getStatus(b))
  )

  return { enrolled: [], fallback: sorted[0] ?? null }
}

/**
 * Convert a FilteredEnrollment to a flat display list:
 * enrolled items if any, otherwise the fallback wrapped in an array.
 */
export function toDisplayList<T>(result: FilteredEnrollment<T>): T[] {
  if (result.enrolled.length > 0) return result.enrolled
  return result.fallback ? [result.fallback] : []
}
