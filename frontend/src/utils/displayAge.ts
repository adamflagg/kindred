/**
 * Display age utility implementing Option C:
 * - Current/active year: use stored person.age from CampMinder daily sync
 * - Historical years: calculate dynamically from birthdate - yearDiff
 *
 * This ensures age display is always accurate to the viewing date
 * while maintaining CampMinder's years.months format.
 */

import { calculateAge } from './ageCalculator';

export interface PersonWithAge {
  age?: number | undefined;
  birthdate?: string | undefined;
}

/**
 * Get the active camp year (the year with daily synced data)
 *
 * Camp season logic:
 * - Jan-May: previous calendar year (last summer's data)
 * - Jun-Dec: current calendar year (this summer's data)
 */
export function getActiveYear(): number {
  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11

  // If we're in Jan-May (months 0-4), the active camp year is previous calendar year
  return currentMonth < 5 ? currentCalendarYear - 1 : currentCalendarYear;
}

/**
 * Get display age for a person based on viewing context
 *
 * @param person - Person record with optional age and birthdate
 * @param viewingYear - The year being viewed in the UI
 * @param activeYear - The active camp year (where daily syncs run)
 * @returns Age in CampMinder format (years.months) or null if unavailable
 *
 * Strategy:
 * - If viewing active year AND stored age exists: use stored age (CampMinder authoritative)
 * - Otherwise: calculate from birthdate and adjust for year difference
 */
export function getDisplayAge(
  person: PersonWithAge,
  viewingYear: number,
  activeYear: number
): number | null {
  const isViewingActiveYear = viewingYear === activeYear;

  // Active year with stored age: use CampMinder's authoritative value
  if (isViewingActiveYear && person.age !== undefined) {
    return person.age;
  }

  // Need birthdate for calculation
  if (!person.birthdate) {
    // For active year without stored age, return null (can't calculate)
    // For historical years without birthdate, also return null
    return isViewingActiveYear ? (person.age ?? null) : null;
  }

  // Calculate current age from birthdate (age as of today)
  const currentAge = calculateAge(person.birthdate);

  // Determine year difference relative to active year
  // This ensures active year shows current age, historical years are adjusted back
  const yearDiff = activeYear - viewingYear;

  // Adjust age by year difference
  // CampMinder format: years.months where months is 00-11
  // Simple subtraction works because we're only adjusting whole years
  const adjustedAge = currentAge - yearDiff;

  // Round to 2 decimal places to avoid floating point issues
  // and preserve CampMinder format
  return Math.round(adjustedAge * 100) / 100;
}

/**
 * Hook-friendly version that uses getActiveYear() automatically
 *
 * @param person - Person record with optional age and birthdate
 * @param viewingYear - The year being viewed in the UI
 * @returns Age in CampMinder format (years.months) or null if unavailable
 */
export function getDisplayAgeForYear(
  person: PersonWithAge,
  viewingYear: number
): number | null {
  return getDisplayAge(person, viewingYear, getActiveYear());
}
