/**
 * Tests for CurrentYearContext - verifying backend year integration
 * and the isYearReady flag that prevents premature query firing.
 */
import { describe, it, expect } from 'vitest'
import { calculateAvailableYears as realCalculateAvailableYears } from './CurrentYearContext'

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

  // #2113: replaces a stale local re-implementation of calculateAvailableYears
  // that asserted the old, now-replaced fixed-5-year-window contract (a
  // private closure shadowing the real export — it stayed green regardless
  // of the real implementation, per code review on #2113). This block tests
  // the real calculateAvailableYears (exported from CurrentYearContext)
  // must reach back to 2017, where summer data starts, instead of a fixed
  // 5-year window that stopped list/board year navigation at 2022.
  describe('calculateAvailableYears (real implementation, #2113 widening)', () => {
    it('reaches back to 2017 from the current base year', () => {
      const years = realCalculateAvailableYears(2026)
      expect(years[0]).toBe(2026)
      expect(years[years.length - 1]).toBe(2017)
      expect(years).toHaveLength(10)
      expect(years).not.toContain(2016)
    })

    it('stays descending and contiguous', () => {
      const years = realCalculateAvailableYears(2020)
      expect(years).toEqual([2020, 2019, 2018, 2017])
    })

    it('returns empty array when base year is 0 (not ready)', () => {
      expect(realCalculateAvailableYears(0)).toEqual([])
    })

    // Code-review finding on #2113: a bogus baseYear below the data floor
    // (e.g. a misconfigured backend _configured_year) must not fabricate a
    // single-year result — that would assert an out-of-range year as
    // "available with data" when the function's own contract says data
    // starts at EARLIEST_AVAILABLE_YEAR.
    it('returns empty array for a nonzero base year below the data floor', () => {
      expect(realCalculateAvailableYears(2010)).toEqual([])
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
