/** `persons.grade` for a camper past 12th grade — CampMinder's "12th+". */
export const GRADUATED_GRADE = 13
export const GRADUATED_SHORT = 'Grad'
export const GRADUATED_LONG = 'Graduated'

/**
 * Convert a grade number to its ordinal format
 * @param grade The grade number: 0 (K, or no grade) .. 12, 13 past 12th grade,
 *   -1 .. -4 below K
 * @returns The ordinal string (1st, 2nd, 3rd, etc.); "Grad" for 13; '' for a
 *   negative grade, which has no ordinal
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
  // print nothing rather than "-1th". A surface that must show those grades
  // reads `grade_name` through `formatGradeName` instead.
  if (gradeNum < 0) {
    return ''
  }

  // Past 12th grade (CampMinder's "12th+") — owner ruling 2026-09-23.
  if (gradeNum === GRADUATED_GRADE) {
    return GRADUATED_SHORT
  }

  // Special handling for 11, 12
  if (gradeNum >= 11 && gradeNum <= 12) {
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

export type GradeStyle = 'short' | 'long'

/**
 * The grade staff read, from `persons.grade_name` (kindred#2779).
 *
 * CampMinder names grades "Infant", "Toddler", "Nursery", "Pre-K", "K", then
 * "1st" .. "12th" and "12th+". Two styles, owner rulings 2026-09-23:
 *
 * - `short` — tight spaces (the board side panel, sibling rows, the weekend
 *   panels): "5th", "K", "Grad".
 * - `long` — the full camper record: "5th Grade", "Kindergarten", "Graduated".
 *
 * Pre-K and below read as named in both. An empty name means CampMinder has no
 * grade, and returns null so the caller shows nothing — never the numeric
 * `grade`, which reads 0 for both K and "no grade" and goes negative below K.
 */
export function formatGradeName(
  gradeName: string | null | undefined,
  style: GradeStyle
): string | null {
  if (!gradeName) return null
  const long = style === 'long'
  if (gradeName === '12th+') return long ? GRADUATED_LONG : GRADUATED_SHORT
  if (gradeName === 'K') return long ? 'Kindergarten' : 'K'
  if (long && /^\d/.test(gradeName)) return `${gradeName} Grade`
  return gradeName
}
