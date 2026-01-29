/**
 * Display age utility
 *
 * Uses stored person.age with year adjustment based on current calendar year.
 * Falls back to birthdate calculation if stored age is missing.
 *
 * Data model: persons table stores same age (at sync time) for all year records.
 * Frontend adjusts for historical viewing: currentCalendarYear - viewingYear
 *
 * Example (in January 2026, stored age is 15.04):
 * - Viewing 2026: 15.04 - 0 = 15.04
 * - Viewing 2025: 15.04 - 1 = 14.04
 * - Viewing 2024: 15.04 - 2 = 13.04
 */

import { calculateAge } from './ageCalculator';

export interface PersonWithAge {
  age?: number | undefined;
  birthdate?: string | undefined;
}

/**
 * Get display age for a person based on viewing context
 *
 * @param person - Person record with optional age and birthdate
 * @param viewingYear - The year being viewed in the UI
 * @returns Age in CampMinder format (years.months) or null if unavailable
 *
 * Strategy:
 * - Prefer stored age with year adjustment
 * - Fall back to birthdate calculation if stored age is missing
 */
export function getDisplayAge(
  person: PersonWithAge,
  viewingYear: number
): number | null {
  const currentYear = new Date().getFullYear();
  const yearDiff = currentYear - viewingYear;

  // Prefer stored age with year adjustment
  if (person.age !== undefined) {
    const adjustedAge = person.age - yearDiff;
    return Math.round(adjustedAge * 100) / 100;
  }

  // Fallback: calculate from birthdate if available
  if (person.birthdate) {
    const currentAge = calculateAge(person.birthdate);
    const adjustedAge = currentAge - yearDiff;
    return Math.round(adjustedAge * 100) / 100;
  }

  return null;
}

/**
 * Hook-friendly version (convenience wrapper)
 *
 * @param person - Person record with optional age and birthdate
 * @param viewingYear - The year being viewed in the UI
 * @returns Age in CampMinder format (years.months) or null if unavailable
 */
export function getDisplayAgeForYear(
  person: PersonWithAge,
  viewingYear: number
): number | null {
  return getDisplayAge(person, viewingYear);
}
