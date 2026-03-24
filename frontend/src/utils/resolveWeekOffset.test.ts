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
  it('returns undefined when no new options (no change needed)', () => {
    expect(resolveWeekOffset(null, [], [])).toBeUndefined()
  })

  it('returns undefined when on Today and new year has Today', () => {
    const prev = [makeOption(19, true), makeOption(18), makeOption(17)]
    const next = [makeOption(19, true), makeOption(18), makeOption(17)]
    expect(resolveWeekOffset(null, next, prev)).toBeUndefined()
  })

  it('maps Today to equivalent week in past season', () => {
    // Previous year: Today is week 19
    const prev = [makeOption(19, true), makeOption(18), makeOption(17)]
    // Past season: weeks 41 down to 1 (no Today)
    const next = [makeOption(41), makeOption(20), makeOption(19), makeOption(18), makeOption(1)]
    // Should map to week 19, not week 41
    expect(resolveWeekOffset(null, next, prev)).toBe(next[2]!.day_offset)
  })

  it('maps Today to closest week when exact week missing in past season', () => {
    // Previous year: Today is week 42 (beyond SEASON_WEEKS)
    const prev = [makeOption(42, true), makeOption(41)]
    // Past season caps at 41
    const next = [makeOption(41), makeOption(40), makeOption(39)]
    // Should map to closest (41), not just first
    expect(resolveWeekOffset(null, next, prev)).toBe(next[0]!.day_offset)
  })

  it('falls back to first option when no previous options exist', () => {
    // No previous options (initial load of past season)
    const next = [makeOption(41), makeOption(40), makeOption(39)]
    expect(resolveWeekOffset(null, next, [])).toBe(next[0]!.day_offset)
  })

  it('returns undefined when dayOffset matches an existing option', () => {
    const prev = [makeOption(19, true), makeOption(18), makeOption(17)]
    const next = [makeOption(19, true), makeOption(18), makeOption(17)]
    // day_offset for week 18 = 18*7-1 = 125
    expect(resolveWeekOffset(125, next, prev)).toBeUndefined()
  })

  it('returns closest week offset when dayOffset has no exact match', () => {
    const prev = [makeOption(22, true), makeOption(21)]
    // Past season with weeks 41,40,39 — user had dayOffset=154 (Today exact for week 22)
    const next = [makeOption(41), makeOption(40), makeOption(39)]
    // dayOffset 154 → week ~22 → closest to 39
    expect(resolveWeekOffset(154, next, prev)).toBe(next[2]!.day_offset)
  })

  it('returns closest week for mid-range mismatch', () => {
    const prev = [makeOption(19, true), makeOption(18)]
    const next = [makeOption(41), makeOption(20), makeOption(10), makeOption(1)]
    // dayOffset 132 → week ~19 → closest to 20
    expect(resolveWeekOffset(132, next, prev)).toBe(next[1]!.day_offset)
  })
})
