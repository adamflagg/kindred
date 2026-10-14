import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { CurrentYearContext } from '../hooks/useCurrentYear'
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI'

const STORAGE_KEY = 'bunking-current-year'

/**
 * Earliest year with historical attendee data — summer data starts in 2017
 * (#2113). Was a fixed 5-year window, which blocked list/board year
 * navigation to 2017-2021 even though the underlying data (and the camper
 * journey timeline, which reads prior years directly) goes back that far.
 */
export const EARLIEST_AVAILABLE_YEAR = 2017

// Calculate available years: descending from baseYear back through the
// earliest year with data, rather than a fixed-size window (#2113).
// eslint-disable-next-line react-refresh/only-export-components
export function calculateAvailableYears(baseYear: number): number[] {
  if (baseYear === 0) return []
  const length = baseYear - EARLIEST_AVAILABLE_YEAR + 1
  if (length <= 0) return []
  return Array.from({ length }, (_, i) => baseYear - i)
}

/** What the browser remembers: the year AND the primary it was saved under, so the Oct 15
 *  rollover can tell "still on the old primary" from "deliberately picked the prior season". */
// eslint-disable-next-line react-refresh/only-export-components
export function serializeSavedYear(year: number, primary: number): string {
  return JSON.stringify({ year, primary })
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveSavedYear(
  raw: string | null,
  primary: number,
  available: number[]
): { year: number | null; migrate: boolean } {
  if (!raw) return { year: null, migrate: false }
  let saved: { year: number; primary: number | null } | null = null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'number') saved = { year: parsed, primary: null }
    else if (parsed && typeof parsed === 'object' && 'year' in parsed && 'primary' in parsed) {
      const p = parsed
      if (typeof p.year === 'number' && typeof p.primary === 'number')
        saved = { year: p.year, primary: p.primary }
    }
  } catch {
    saved = null
  }
  if (!saved) return { year: null, migrate: false }
  // Legacy plain number: no record of the primary it was saved under.
  if (saved.primary === null) {
    if (saved.year === primary - 1 || saved.year === primary)
      return { year: primary, migrate: true }
    return available.includes(saved.year)
      ? { year: saved.year, migrate: false }
      : { year: null, migrate: false }
  }
  // Saved on an older primary, and it WAS that primary: the one-time move.
  if (saved.primary < primary && saved.year === saved.primary)
    return { year: primary, migrate: true }
  return available.includes(saved.year)
    ? { year: saved.year, migrate: false }
    : { year: null, migrate: false }
}

function getStoredYear(availableYears: number[], primary: number): number | null {
  return resolveSavedYear(localStorage.getItem(STORAGE_KEY), primary, availableYears).year
}

function getDefaultYear(availableYears: number[], baseYear: number): number {
  // First try localStorage
  const stored = getStoredYear(availableYears, baseYear)
  if (stored) return stored

  // Default to base year
  if (availableYears.includes(baseYear)) {
    return baseYear
  }
  return availableYears[0] ?? baseYear
}

export function CurrentYearProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Fetch configured year from backend sync status
  const { data: syncStatus } = useSyncStatusAPI()
  const backendYear = syncStatus?._configured_year

  // No client-side fallback: wait for backend to provide the year.
  // This prevents queries from firing with wrong year before auth/config loads.
  const isYearReady = backendYear !== undefined
  const configuredYear = backendYear ?? 0

  // Calculate available years based on configured year (empty when not ready)
  const AVAILABLE_YEARS = useMemo(() => calculateAvailableYears(configuredYear), [configuredYear])

  // Get year from URL param, or fall back to stored/default
  const yearFromUrl = useMemo(() => {
    const urlYear = searchParams.get('year')
    if (!urlYear) return null
    // When available years is empty (not ready), don't reject valid years
    if (AVAILABLE_YEARS.length === 0) return null
    const parsed = parseInt(urlYear, 10)
    if (!isNaN(parsed) && AVAILABLE_YEARS.includes(parsed)) {
      return parsed
    }
    return null
  }, [searchParams, AVAILABLE_YEARS])

  // The effective current year: 0 when not ready, otherwise URL > stored > default
  const currentYear = isYearReady
    ? (yearFromUrl ?? getDefaultYear(AVAILABLE_YEARS, configuredYear))
    : 0

  // Persist to localStorage only when NOT coming from URL
  // (URL year is a "view override", not a preference change)
  useEffect(() => {
    // Only persist to localStorage after backend config is known
    // This prevents overwriting the user's preference before we know the valid years
    if (!yearFromUrl && isYearReady && currentYear > 0) {
      localStorage.setItem(STORAGE_KEY, serializeSavedYear(currentYear, configuredYear))
    }
  }, [currentYear, yearFromUrl, isYearReady, configuredYear])

  const setCurrentYear = useCallback(
    (year: number) => {
      if (!AVAILABLE_YEARS.includes(year)) {
        console.error(`Year ${year} is not available. Available years:`, AVAILABLE_YEARS)
        return
      }

      if (year === currentYear) {
        return
      }

      // Show transitioning state while data reloads
      setIsTransitioning(true)

      // Update URL with new year (preserving other params)
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.set('year', year.toString())
          return newParams
        },
        { replace: true }
      )

      // Also save to localStorage as the new preference
      localStorage.setItem(STORAGE_KEY, serializeSavedYear(year, configuredYear))

      // Clear transitioning state after a short delay
      setTimeout(() => {
        setIsTransitioning(false)
      }, 500)
    },
    [currentYear, setSearchParams, AVAILABLE_YEARS, configuredYear]
  )

  return (
    <CurrentYearContext
      value={{
        currentYear,
        setCurrentYear,
        availableYears: AVAILABLE_YEARS,
        isTransitioning,
        isYearReady,
      }}
    >
      {children}
    </CurrentYearContext>
  )
}
