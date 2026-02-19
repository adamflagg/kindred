import { describe, it, expect } from 'vitest'
import { getYearColor, YEAR_PALETTE } from '../yearColors'

describe('getYearColor', () => {
  it('returns Gold for the most recent year (offset 0)', () => {
    expect(getYearColor(2026, 2026)).toBe(YEAR_PALETTE[0])
  })

  it('returns Green for one year before max (offset 1)', () => {
    expect(getYearColor(2025, 2026)).toBe(YEAR_PALETTE[1])
  })

  it('returns Blue for two years before max (offset 2)', () => {
    expect(getYearColor(2024, 2026)).toBe(YEAR_PALETTE[2])
  })

  it('returns Purple for three years before max (offset 3)', () => {
    expect(getYearColor(2023, 2026)).toBe(YEAR_PALETTE[3])
  })

  it('returns Red for four years before max (offset 4)', () => {
    expect(getYearColor(2022, 2026)).toBe(YEAR_PALETTE[4])
  })

  it('keeps colors stable when toggling between 3 and 5 years', () => {
    // In a 3-year view [2024, 2025, 2026], 2026 is Gold
    const gold3 = getYearColor(2026, 2026)
    // In a 5-year view [2022..2026], 2026 is still Gold
    const gold5 = getYearColor(2026, 2026)
    expect(gold3).toBe(gold5)

    // 2025 stays Green regardless of how many years are shown
    const green3 = getYearColor(2025, 2026)
    const green5 = getYearColor(2025, 2026)
    expect(green3).toBe(green5)
  })

  it('returns fallback gray for offsets beyond the palette', () => {
    const color = getYearColor(2020, 2026)
    expect(color).toBe('hsl(0, 0%, 50%)')
  })

  it('handles same year as max', () => {
    expect(getYearColor(2025, 2025)).toBe(YEAR_PALETTE[0])
  })
})
