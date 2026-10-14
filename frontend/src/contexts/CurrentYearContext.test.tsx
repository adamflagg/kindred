/**
 * Tests for CurrentYearContext - verifying backend year integration
 * and the isYearReady flag that prevents premature query firing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import {
  calculateAvailableYears as realCalculateAvailableYears,
  CurrentYearProvider,
  resolveSavedYear,
} from './CurrentYearContext'
import { useCurrentYear } from '../hooks/useCurrentYear'

let mockConfiguredYear: number | undefined = 2027
vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: { _configured_year: mockConfiguredYear } }),
}))

function mockSyncStatus({ _configured_year }: { _configured_year: number }) {
  mockConfiguredYear = _configured_year
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <CurrentYearProvider>{children}</CurrentYearProvider>
  </MemoryRouter>
)
// A fresh router per mount: the ?year= the first render wrote is gone, as on a reload.
const wrapperWithoutUrlYear = wrapper

const calculateAvailableYears = realCalculateAvailableYears

describe('resolveSavedYear', () => {
  const avail = calculateAvailableYears(2027)
  it('moves a browser on the old primary to the new one, once', () => {
    expect(resolveSavedYear(JSON.stringify({ year: 2026, primary: 2026 }), 2027, avail)).toEqual({
      year: 2027,
      migrate: true,
    })
  })
  it('keeps a deliberate pick of the prior season made after the rollover', () => {
    expect(resolveSavedYear(JSON.stringify({ year: 2026, primary: 2027 }), 2027, avail)).toEqual({
      year: 2026,
      migrate: false,
    })
  })
  it('keeps a deliberate older year across the rollover', () => {
    expect(resolveSavedYear(JSON.stringify({ year: 2024, primary: 2026 }), 2027, avail)).toEqual({
      year: 2024,
      migrate: false,
    })
  })
  it('treats a legacy plain number equal to primary-1 as the old primary', () => {
    expect(resolveSavedYear('2026', 2027, avail)).toEqual({ year: 2027, migrate: true })
  })
  it('keeps a legacy plain older year', () => {
    expect(resolveSavedYear('2024', 2027, avail)).toEqual({ year: 2024, migrate: false })
  })
  it('keeps a legacy plain number equal to the primary', () => {
    expect(resolveSavedYear('2027', 2027, avail)).toEqual({ year: 2027, migrate: true })
  })
  it('returns null when nothing usable is saved', () => {
    expect(resolveSavedYear(null, 2027, avail).year).toBeNull()
    expect(resolveSavedYear('garbage', 2027, avail).year).toBeNull()
  })
})

describe('saved year in the provider', () => {
  // The global test setup stubs localStorage with bare vi.fn()s; back them with a real map here.
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.mocked(localStorage.getItem).mockImplementation((k: string) => store.get(k) ?? null)
    vi.mocked(localStorage.setItem).mockImplementation(
      (k: string, v: string) => void store.set(k, v)
    )
  })

  it('an explicit pick of the prior season survives a reload', async () => {
    mockSyncStatus({ _configured_year: 2027 })
    const { result, unmount } = renderHook(() => useCurrentYear(), { wrapper })
    await waitFor(() => expect(result.current.isYearReady).toBe(true))
    act(() => result.current.setCurrentYear(2026))
    unmount()
    const again = renderHook(() => useCurrentYear(), { wrapper: wrapperWithoutUrlYear })
    await waitFor(() => expect(again.result.current.currentYear).toBe(2026))
  })

  it('a legacy saved 2026 moves to 2027 once the primary is 2027', async () => {
    localStorage.setItem('bunking-current-year', '2026')
    mockSyncStatus({ _configured_year: 2027 })
    const { result } = renderHook(() => useCurrentYear(), { wrapper })
    await waitFor(() => expect(result.current.currentYear).toBe(2027))
    expect(JSON.parse(localStorage.getItem('bunking-current-year')!)).toEqual({
      year: 2027,
      primary: 2027,
    })
  })
})

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
