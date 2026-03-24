import type { WeekOption } from '../types/forecast'

/**
 * Resolve dayOffset when weekOptions change (e.g., year switch).
 * Returns the new dayOffset to use, or undefined if no change needed.
 */
export function resolveWeekOffset(
  currentDayOffset: number | null,
  weekOptions: WeekOption[]
): number | null | undefined {
  if (weekOptions.length === 0) return undefined

  const hasTodayOption = weekOptions.some((o) => o.is_today)

  if (currentDayOffset === null && hasTodayOption) return undefined
  if (currentDayOffset === null && !hasTodayOption) return weekOptions[0]!.day_offset

  const match = weekOptions.find((o) => o.day_offset === currentDayOffset)
  if (match) return undefined

  const currentWeek = currentDayOffset !== null ? Math.floor(currentDayOffset / 7) + 1 : 1
  const closest = weekOptions.reduce((prev, curr) =>
    Math.abs(curr.week_number - currentWeek) < Math.abs(prev.week_number - currentWeek)
      ? curr
      : prev
  )
  return closest.day_offset
}
