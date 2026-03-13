/**
 * Shared status badge component for displaying attendee enrollment status.
 * Renders a colored pill for non-enrolled statuses, nothing for enrolled.
 */

interface StatusConfig {
  label: string
  classes: string
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  waitlisted: {
    label: 'Waitlisted',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  dismissed: {
    label: 'Dismissed',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  left_early: {
    label: 'Left Early',
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
  applied: {
    label: 'Applied',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  withdrawn: {
    label: 'Withdrawn',
    classes: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  inquiry: {
    label: 'Inquiry',
    classes: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  incomplete: {
    label: 'Incomplete',
    classes: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
  none: {
    label: 'No Status',
    classes: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  },
}

const DEFAULT_CONFIG: StatusConfig = {
  label: 'Unknown',
  classes: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
}

interface StatusBadgeProps {
  status: string | undefined
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (!status || status === 'enrolled') return null

  const config = STATUS_CONFIG[status] ?? DEFAULT_CONFIG

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${config.classes}`}>
      {config.label}
    </span>
  )
}
