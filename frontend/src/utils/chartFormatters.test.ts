import { describe, it, expect } from 'vitest'
import {
  formatLabelListValue,
  formatLabelListPercent,
  formatDateShort,
  priorYearDailyDateLabel,
} from './chartFormatters'

describe('formatLabelListValue', () => {
  it('formats numbers with locale separators', () => {
    expect(formatLabelListValue(1234)).toBe('1,234')
    expect(formatLabelListValue(0)).toBe('0')
  })

  it('coerces non-numbers to string', () => {
    expect(formatLabelListValue('hello')).toBe('hello')
    expect(formatLabelListValue(null)).toBe('')
    expect(formatLabelListValue(undefined)).toBe('')
  })
})

describe('formatLabelListPercent', () => {
  it('formats numbers with one decimal and percent sign', () => {
    expect(formatLabelListPercent(12.345)).toBe('12.3%')
    expect(formatLabelListPercent(0)).toBe('0.0%')
  })

  it('coerces non-numbers to string', () => {
    expect(formatLabelListPercent('foo')).toBe('foo')
    expect(formatLabelListPercent(null)).toBe('')
  })
})

describe('formatDateShort', () => {
  it('formats YYYY-MM-DD as locale short', () => {
    expect(formatDateShort('2026-01-06')).toMatch(/Jan 6/)
  })
})

describe('priorYearDailyDateLabel', () => {
  it('returns null when seasonStarts missing', () => {
    expect(priorYearDailyDateLabel(undefined, 2025, 0)).toBeNull()
    expect(priorYearDailyDateLabel({}, 2025, 0)).toBeNull()
  })

  it('offsets by day count', () => {
    const result = priorYearDailyDateLabel({ 2025: '2025-06-15' }, 2025, 2)
    expect(result).toMatch(/Jun 17/)
  })
})
