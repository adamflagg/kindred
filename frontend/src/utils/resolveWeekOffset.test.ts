import { describe, it, expect } from 'vitest'
import { resolveWeekOffset } from './resolveWeekOffset'
import type { WeekOption } from '../types/forecast'

function makeOption(week: number, isToday = false): WeekOption {
  return {
    week_number: week,
    day_offset: isToday ? week * 7 - 3 : week * 7 - 1, // today has exact offset
    label: `Week ${week}`,
    is_today: isToday,
  }
}

describe('resolveWeekOffset', () => {
  it('returns undefined when no new options', () => {
    expect(resolveWeekOffset(null, [], null)).toBeUndefined()
  })

  it('returns undefined when on Today and new year has Today', () => {
    const options = [makeOption(19, true), makeOption(18), makeOption(17)]
    expect(resolveWeekOffset(null, options, 19)).toBeUndefined()
  })

  it('maps Today to equivalent week in past season', () => {
    // Past season (no Today), todayWeek=19 from current season
    const options = [makeOption(41), makeOption(20), makeOption(19), makeOption(18), makeOption(1)]
    // Should map to week 19
    expect(resolveWeekOffset(null, options, 19)).toBe(options[2]!.day_offset)
  })

  it('maps Today to closest week when exact week missing in past season', () => {
    // todayWeek=42 but past season caps at 41
    const options = [makeOption(41), makeOption(40), makeOption(39)]
    expect(resolveWeekOffset(null, options, 42)).toBe(options[0]!.day_offset)
  })

  it('returns undefined when todayWeek not yet loaded (waits)', () => {
    // Past season, todayWeek still null → don't remap yet
    const options = [makeOption(41), makeOption(40), makeOption(39)]
    expect(resolveWeekOffset(null, options, null)).toBeUndefined()
  })

  it('returns undefined when dayOffset matches an existing option', () => {
    const options = [makeOption(19, true), makeOption(18), makeOption(17)]
    // day_offset for week 18 = 18*7-1 = 125
    expect(resolveWeekOffset(125, options, 19)).toBeUndefined()
  })

  it('returns closest week offset when dayOffset has no exact match', () => {
    // Past season with weeks 41,40,39 — user had dayOffset=154 (Today exact for week 22)
    const options = [makeOption(41), makeOption(40), makeOption(39)]
    // dayOffset 154 → week ~22 → closest to 39
    expect(resolveWeekOffset(154, options, 19)).toBe(options[2]!.day_offset)
  })

  it('returns closest week for mid-range mismatch', () => {
    const options = [makeOption(41), makeOption(20), makeOption(10), makeOption(1)]
    // dayOffset 132 → week ~19 → closest to 20
    expect(resolveWeekOffset(132, options, 19)).toBe(options[1]!.day_offset)
  })
})
