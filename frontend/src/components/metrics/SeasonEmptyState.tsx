/**
 * SeasonEmptyState — every Analytics page body while the viewed season has no countable summer
 * rows (PR 4, board 9 option A, owner 2026-10-14). MetricsLayout renders it in place of the page;
 * the header, tabs, picker and season bar stay.
 *
 * One line and a link to the prior season. No icon, no banner, no big number (UI taste). An
 * optional second line names the priority date once staff have entered it in Admin.
 */

import { formatPriorityDate } from '../../hooks/useRegistrationDates'

/** The priority-date line is an owner pick still open (question 4): flip it off here. */
export const SHOW_PRIORITY_DATE: boolean = true

interface SeasonEmptyStateProps {
  year: number
  prior: number
  /** The season's enrollment sync has never run: say so rather than "no enrollments". */
  neverSynced: boolean
  /** The season's stored priority registration date, if configured. */
  priorityDate?: string | undefined
  onViewPrior: () => void
  /** Injected for tests. */
  today?: Date
}

/** "opens" is only true until the day ends; after that the line would be wrong, so drop it. */
function priorityLine(stored: string | undefined, today: Date): string | null {
  if (!SHOW_PRIORITY_DATE || !stored) return null
  const label = formatPriorityDate(stored)
  if (!label) return null
  const [y, m, d] = stored.slice(0, 10).split('-').map(Number)
  const endOfDay = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1)
  return today < endOfDay ? `Priority registration opens ${label}.` : null
}

export function SeasonEmptyState({
  year,
  prior,
  neverSynced,
  priorityDate,
  onViewPrior,
  today = new Date(),
}: SeasonEmptyStateProps) {
  const lead = neverSynced
    ? `${year} hasn't synced from CampMinder yet`
    : `No enrollments yet for ${year}`
  const second = priorityLine(priorityDate, today)
  return (
    <div className="card-lodge px-6 py-8 text-center">
      <p className="text-foreground text-base font-semibold">
        {lead} —{' '}
        <button
          type="button"
          onClick={onViewPrior}
          className="text-primary cursor-pointer hover:underline"
        >
          view {prior}
        </button>
      </p>
      {second && <p className="text-muted-foreground mt-1 text-sm">{second}</p>}
    </div>
  )
}
