import type { WeekOption } from '../types/forecast'

/**
 * Resolve dayOffset when weekOptions change (e.g., year switch or initial load).
 * Returns the new dayOffset to use, or undefined if no change needed.
 *
 * @param currentDayOffset - Current dayOffset state (null = "Today")
 * @param newOptions - Week options for the selected year
 * @param todayWeek - Today's week number in the current season (from the
 *   latest year's Today entry). Used to find the equivalent week when
 *   switching to a past season.
 */
export function resolveWeekOffset(
  currentDayOffset: number | null,
  newOptions: WeekOption[],
  todayWeek: number | null
): number | null | undefined {
  if (newOptions.length === 0) return undefined

  const hasTodayOption = newOptions.some((o) => o.is_today)

  // Current season with Today → keep null (live mode)
  if (currentDayOffset === null && hasTodayOption) return undefined

  // Past season (no Today): find the equivalent of today's week
  if (currentDayOffset === null && !hasTodayOption) {
    if (todayWeek !== null) {
      return findClosestWeek(newOptions, todayWeek)
    }
    // todayWeek not yet loaded — caller should wait before remapping
    return undefined
  }

  // Specific week selected — check if it exists in new options
  const match = newOptions.find((o) => o.day_offset === currentDayOffset)
  if (match) return undefined

  // No exact match — find closest week by week_number
  const currentWeek = currentDayOffset !== null ? Math.floor(currentDayOffset / 7) + 1 : 1
  return findClosestWeek(newOptions, currentWeek)
}

function findClosestWeek(options: WeekOption[], targetWeek: number): number {
  const closest = options.reduce((prev, curr) =>
    Math.abs(curr.week_number - targetWeek) < Math.abs(prev.week_number - targetWeek) ? curr : prev
  )
  return closest.day_offset
}
