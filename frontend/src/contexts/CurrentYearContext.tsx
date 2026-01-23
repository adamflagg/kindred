import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { CurrentYearContext } from '../hooks/useCurrentYear';
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI';

const STORAGE_KEY = 'bunking-current-year';

// Available years for the dropdown - most recent 5 years (descending)
const currentCalendarYear = new Date().getFullYear();
const currentMonth = new Date().getMonth(); // 0-11

// For summer camp: if we're in Jan-May (months 0-4), the most recent camp year
// is the previous calendar year (last summer). Jun-Dec uses current year.
const clientFallbackYear = currentMonth < 5 ? currentCalendarYear - 1 : currentCalendarYear;

// Calculate available years based on a base year
function calculateAvailableYears(baseYear: number): number[] {
  return Array.from({ length: 5 }, (_, i) => baseYear - i);
}

function getStoredYear(availableYears: number[]): number | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const year = parseInt(stored, 10);
    if (!isNaN(year) && availableYears.includes(year)) {
      return year;
    }
  }
  return null;
}

function getDefaultYear(availableYears: number[], baseYear: number): number {
  // First try localStorage
  const stored = getStoredYear(availableYears);
  if (stored) return stored;

  // Default to base year
  if (availableYears.includes(baseYear)) {
    return baseYear;
  }
  return availableYears[0] ?? baseYear;
}

export function CurrentYearProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Fetch configured year from backend sync status
  const { data: syncStatus } = useSyncStatusAPI();
  const backendYear = syncStatus?._configured_year;

  // Use backend year if available, otherwise fall back to client-side calculation
  const configuredYear = backendYear ?? clientFallbackYear;

  // Calculate available years based on configured year
  const AVAILABLE_YEARS = useMemo(
    () => calculateAvailableYears(configuredYear),
    [configuredYear]
  );

  // Get year from URL param, or fall back to stored/default
  const yearFromUrl = useMemo(() => {
    const urlYear = searchParams.get('year');
    if (urlYear) {
      const parsed = parseInt(urlYear, 10);
      if (!isNaN(parsed) && AVAILABLE_YEARS.includes(parsed)) {
        return parsed;
      }
    }
    return null;
  }, [searchParams, AVAILABLE_YEARS]);

  // The effective current year: URL param takes priority, then localStorage/default
  const currentYear = yearFromUrl ?? getDefaultYear(AVAILABLE_YEARS, configuredYear);

  // Persist to localStorage only when NOT coming from URL
  // (URL year is a "view override", not a preference change)
  useEffect(() => {
    if (!yearFromUrl) {
      localStorage.setItem(STORAGE_KEY, currentYear.toString());
    }
  }, [currentYear, yearFromUrl]);

  const setCurrentYear = useCallback((year: number) => {
    if (!AVAILABLE_YEARS.includes(year)) {
      console.error(`Year ${year} is not available. Available years:`, AVAILABLE_YEARS);
      return;
    }

    if (year === currentYear) {
      return;
    }

    // Show transitioning state while data reloads
    setIsTransitioning(true);

    // Update URL with new year (preserving other params)
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      newParams.set('year', year.toString());
      return newParams;
    }, { replace: true });

    // Also save to localStorage as the new preference
    localStorage.setItem(STORAGE_KEY, year.toString());

    // Clear transitioning state after a short delay
    setTimeout(() => {
      setIsTransitioning(false);
    }, 500);
  }, [currentYear, setSearchParams, AVAILABLE_YEARS]);

  return (
    <CurrentYearContext.Provider
      value={{
        currentYear,
        setCurrentYear,
        availableYears: AVAILABLE_YEARS,
        isTransitioning,
      }}
    >
      {children}
    </CurrentYearContext.Provider>
  );
}
