import { describe, it, expect } from 'vitest'
import {
  pickComparisonYear,
  vsPriorSamePoint,
  formatHistoryStart,
  todayWeekNumber,
  buildLegendLabels,
} from './velocityCompare'

describe('pickComparisonYear', () => {
  it('picks the most recent selected year present in the response', () => {
    expect(pickComparisonYear([2023, 2025, 2024], [2024, 2025])).toBe(2025)
  })

  it('ignores a selected year the response omitted', () => {
    expect(pickComparisonYear([2023, 2024], [2025, 2024])).toBe(2024)
  })

  it('ignores a response year that is no longer selected (placeholder data)', () => {
    expect(pickComparisonYear([2025, 2024], [2024])).toBe(2024)
  })

  it('returns null when no selected year is present', () => {
    expect(pickComparisonYear([], [2025])).toBeNull()
    expect(pickComparisonYear([2023], [2025])).toBeNull()
  })

  it('uses every response year when nothing is selected', () => {
    expect(pickComparisonYear([2023, 2024], [])).toBe(2024)
  })
})

describe('vsPriorSamePoint', () => {
  it('subtracts the prior same-point value from the current latest', () => {
    expect(vsPriorSamePoint(120, 100)).toBe(20)
    expect(vsPriorSamePoint(90, 100)).toBe(-10)
  })

  it('is null when either side is missing', () => {
    expect(vsPriorSamePoint(120, null)).toBeNull()
    expect(vsPriorSamePoint(120, undefined)).toBeNull()
    expect(vsPriorSamePoint(null, 100)).toBeNull()
    expect(vsPriorSamePoint(undefined, 100)).toBeNull()
  })

  it('treats zero as a real value', () => {
    expect(vsPriorSamePoint(0, 5)).toBe(-5)
    expect(vsPriorSamePoint(5, 0)).toBe(5)
  })
})

describe('formatHistoryStart', () => {
  it('formats an ISO date as "11 Feb 2026"', () => {
    expect(formatHistoryStart('2026-02-11')).toBe('11 Feb 2026')
  })

  it('accepts a full ISO timestamp', () => {
    expect(formatHistoryStart('2026-02-01T08:30:00Z')).toBe('1 Feb 2026')
  })

  it('returns null for null or malformed input', () => {
    expect(formatHistoryStart(null)).toBeNull()
    expect(formatHistoryStart(undefined)).toBeNull()
    expect(formatHistoryStart('not a date')).toBeNull()
  })
})

describe('todayWeekNumber', () => {
  it('maps a day offset to its 1-based week number', () => {
    expect(todayWeekNumber(0)).toBe(1)
    expect(todayWeekNumber(6)).toBe(1)
    expect(todayWeekNumber(7)).toBe(2)
    expect(todayWeekNumber(80)).toBe(12)
  })
})

describe('buildLegendLabels', () => {
  it('labels the current line "at Wk N" while the season is live', () => {
    const labels = buildLegendLabels({
      currentYear: 2026,
      currentValue: 1135,
      currentWeekNumber: 12,
      isLive: true,
      priors: [{ year: 2025, final: 1190 }],
    })
    expect(labels['2026']).toBe('2026 (1,135 at Wk 12)')
    expect(labels['2025']).toBe('2025 (1,190 final)')
  })

  it('labels the current line "final" once the season is over', () => {
    const labels = buildLegendLabels({
      currentYear: 2026,
      currentValue: 1190,
      currentWeekNumber: 30,
      isLive: false,
      priors: [],
    })
    expect(labels['2026']).toBe('2026 (1,190 final)')
  })

  it('leaves a line with no value as its bare year', () => {
    const labels = buildLegendLabels({
      currentYear: 2026,
      currentValue: null,
      currentWeekNumber: null,
      isLive: true,
      priors: [{ year: 2024, final: null }],
    })
    expect(labels['2026']).toBe('2026')
    expect(labels['2024']).toBe('2024')
  })
})
