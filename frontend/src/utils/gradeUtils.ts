import { ADULT_AGE } from './age'

/**
 * Convert a grade number to its ordinal format
 * @param grade The grade number (1-12)
 * @returns The ordinal string (1st, 2nd, 3rd, etc.)
 */
export function formatGradeOrdinal(grade: number | string | undefined | null): string {
  // Handle edge cases
  if (grade === undefined || grade === null || grade === '') {
    return '?'
  }

  // Convert to number if string
  const gradeNum = typeof grade === 'string' ? parseInt(grade, 10) : grade

  // Handle invalid numbers
  if (isNaN(gradeNum)) {
    return String(grade) // Return original value if not a number
  }

  // Pre-K .. Infant store -1 .. -4 (kindred#2779). The number has no ordinal;
  // print nothing rather than "-1th". Surfaces that show those grades read
  // `grade_name` through `formatGradeName` instead.
  if (gradeNum < 0) {
    return ''
  }

  // Special handling for 11, 12, 13
  if (gradeNum >= 11 && gradeNum <= 13) {
    return `${gradeNum}th`
  }

  // Handle based on last digit
  const lastDigit = gradeNum % 10
  let suffix: string

  switch (lastDigit) {
    case 1:
      suffix = 'st'
      break
    case 2:
      suffix = 'nd'
      break
    case 3:
      suffix = 'rd'
      break
    default:
      suffix = 'th'
  }

  return `${gradeNum}${suffix}`
}

/**
 * The grade as CampMinder names it, or null when none should show.
 *
 * Null when `persons.grade_name` is empty (CampMinder has no grade), and null
 * for anyone `ADULT_AGE` (21) or older — owner ruling 2026-09-23 (#2782).
 * CampMinder keeps advancing a former camper's grade until it reaches "12th+",
 * so an adult can carry a stale one; measured, two people over all years.
 * `age` is the age for the year being shown; unknown shows the grade.
 */
export function visibleGradeName(
  gradeName: string | null | undefined,
  age?: number | null
): string | null {
  if (!gradeName) return null
  if (age !== null && age !== undefined && age >= ADULT_AGE) return null
  return gradeName
}

/**
 * The grade staff read, from `persons.grade_name` (kindred#2779).
 *
 * CampMinder names grades "Infant", "Toddler", "Nursery", "Pre-K", "K", then
 * "1st" .. "12th" and "12th+". An ordinal reads "5th Grade"; the rest read as
 * named. Null — show nothing — under the same rules as `visibleGradeName`,
 * never the numeric `grade`, which reads 0 for both K and "no grade" and goes
 * negative below K.
 */
export function formatGradeName(
  gradeName: string | null | undefined,
  age?: number | null
): string | null {
  const name = visibleGradeName(gradeName, age)
  if (!name) return null
  return /^\d/.test(name) ? `${name} Grade` : name
}
