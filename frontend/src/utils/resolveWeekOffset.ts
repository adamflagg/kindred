import type { WeekOption } from '../types/forecast'

/**
 * Resolve dayOffset when weekOptions change (e.g., year switch).
 * Returns the new dayOffset to use, or undefined if no change needed.
 *
 * @param currentDayOffset - Current dayOffset state (null = "Today")
 * @param newOptions - Week options for the newly selected year
 * @param previousOptions - Week options from the previous year (needed to
 *   look up the week_number when currentDayOffset is null / "Today")
 */
export function resolveWeekOffset(
  currentDayOffset: number | null,
  newOptions: WeekOption[],
  previousOptions: WeekOption[]
): number | null | undefined {
  if (newOptions.length === 0) return undefined

  const hasTodayOption = newOptions.some((o) => o.is_today)

  // Current season → current season: keep "Today"
  if (currentDayOffset === null && hasTodayOption) return undefined

  // "Today" → past season: find equivalent week from previous Today entry
  if (currentDayOffset === null && !hasTodayOption) {
    const prevToday = previousOptions.find((o) => o.is_today)
    if (prevToday) {
      const match = newOptions.find((o) => o.week_number === prevToday.week_number)
      if (match) return match.day_offset
      // Week doesn't exist in past season (e.g., week 42) → closest
      return findClosestWeek(newOptions, prevToday.week_number)
    }
    // No previous Today (shouldn't happen, but fall back to first option)
    return newOptions[0]!.day_offset
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
