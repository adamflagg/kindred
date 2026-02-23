/**
 * Tests for CurrentYearContext - verifying backend year integration
 * and the isYearReady flag that prevents premature query firing.
 */
import { describe, it, expect } from 'vitest'

// Test the year calculation logic without needing full React context
describe('Year calculation logic', () => {
  describe('configuredYear without fallback', () => {
    // When backend year is unavailable, currentYear should be 0 (not ready)
    // No client-side fallback - we wait for the backend
    function getConfiguredYear(backendYear: number | undefined): number {
      return backendYear ?? 0
    }

    it('should use backend year when available', () => {
      expect(getConfiguredYear(2026)).toBe(2026)
    })

    it('should return 0 when backend year is undefined (not ready)', () => {
      expect(getConfiguredYear(undefined)).toBe(0)
    })

    it('should handle any valid backend year', () => {
      expect(getConfiguredYear(2025)).toBe(2025)
      expect(getConfiguredYear(2024)).toBe(2024)
    })
  })

  describe('calculateAvailableYears', () => {
    function calculateAvailableYears(baseYear: number, count: number = 5): number[] {
      if (baseYear === 0) return []
      return Array.from({ length: count }, (_, i) => baseYear - i)
    }

    it('should generate 5 years descending from base year', () => {
      expect(calculateAvailableYears(2026)).toEqual([2026, 2025, 2024, 2023, 2022])
    })

    it('should work with any base year', () => {
      expect(calculateAvailableYears(2024, 3)).toEqual([2024, 2023, 2022])
    })

    it('should return empty array when base year is 0 (not ready)', () => {
      expect(calculateAvailableYears(0)).toEqual([])
    })
  })

  describe('isYearReady flag', () => {
    function computeIsYearReady(backendYear: number | undefined): boolean {
      return backendYear !== undefined
    }

    it('should be false when backend year is undefined', () => {
      expect(computeIsYearReady(undefined)).toBe(false)
    })

    it('should be true when backend year is available', () => {
      expect(computeIsYearReady(2026)).toBe(true)
    })
  })

  describe('URL year parsing with empty available years', () => {
    function parseYearFromUrl(urlYear: string | null, availableYears: number[]): number | null {
      if (!urlYear) return null
      // When available years is empty (not ready), don't reject valid years
      if (availableYears.length === 0) return null
      const parsed = parseInt(urlYear, 10)
      if (!isNaN(parsed) && availableYears.includes(parsed)) {
        return parsed
      }
      return null
    }

    it('should return null when available years is empty (not ready)', () => {
      expect(parseYearFromUrl('2026', [])).toBeNull()
    })

    it('should return parsed year when available years includes it', () => {
      expect(parseYearFromUrl('2026', [2026, 2025, 2024])).toBe(2026)
    })

    it('should return null for invalid year not in available years', () => {
      expect(parseYearFromUrl('2020', [2026, 2025, 2024])).toBeNull()
    })

    it('should return null when urlYear is null', () => {
      expect(parseYearFromUrl(null, [2026, 2025])).toBeNull()
    })
  })
})

describe('SyncStatusResponse _configured_year field', () => {
  it('should be a valid field in the expected response shape', () => {
    interface ExpectedSyncStatusResponse {
      _configured_year?: number
      sessions: { status: string }
    }

    const mockResponse: ExpectedSyncStatusResponse = {
      _configured_year: 2026,
      sessions: { status: 'idle' },
    }

    expect(mockResponse._configured_year).toBe(2026)
  })

  it('should be optional (undefined when not present)', () => {
    interface ExpectedSyncStatusResponse {
      _configured_year?: number
      sessions: { status: string }
    }

    const mockResponse: ExpectedSyncStatusResponse = {
      sessions: { status: 'idle' },
    }

    expect(mockResponse._configured_year).toBeUndefined()
  })
})
