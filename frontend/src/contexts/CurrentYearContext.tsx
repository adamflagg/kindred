import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { CurrentYearContext } from '../hooks/useCurrentYear';

const STORAGE_KEY = 'bunking-current-year';

// Available years for the dropdown - most recent 5 years (descending)
const currentCalendarYear = new Date().getFullYear();
const currentMonth = new Date().getMonth(); // 0-11

// For summer camp: if we're in Jan-May (months 0-4), the most recent camp year
// is the previous calendar year (last summer). Jun-Dec uses current year.
const campSeasonYear = currentMonth < 5 ? currentCalendarYear - 1 : currentCalendarYear;

const AVAILABLE_YEARS = Array.from(
  { length: 5 },
  (_, i) => campSeasonYear - i
);

function getStoredYear(): number | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const year = parseInt(stored, 10);
    if (!isNaN(year) && AVAILABLE_YEARS.includes(year)) {
      return year;
    }
  }
  return null;
}

function getDefaultYear(): number {
  // First try localStorage
  const stored = getStoredYear();
  if (stored) return stored;

  // Default to camp season year (accounts for Jan-May = previous summer)
  if (AVAILABLE_YEARS.includes(campSeasonYear)) {
    return campSeasonYear;
  }
  return AVAILABLE_YEARS[0] ?? campSeasonYear;
}

export function CurrentYearProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isTransitioning, setIsTransitioning] = useState(false);

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
  }, [searchParams]);

  // The effective current year: URL param takes priority, then localStorage/default
  const currentYear = yearFromUrl ?? getDefaultYear();

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
  }, [currentYear, setSearchParams]);

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
