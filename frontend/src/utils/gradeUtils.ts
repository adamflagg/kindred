/**
 * Convert a grade number to its ordinal format
 * @param grade The grade number (1-12)
 * @returns The ordinal string (1st, 2nd, 3rd, etc.)
 */
export function formatGradeOrdinal(grade: number | string | undefined | null): string {
  // Handle edge cases
  if (grade === undefined || grade === null || grade === '') {
    return '?';
  }
  
  // Convert to number if string
  const gradeNum = typeof grade === 'string' ? parseInt(grade, 10) : grade;
  
  // Handle invalid numbers
  if (isNaN(gradeNum)) {
    return String(grade); // Return original value if not a number
  }
  
  // Special handling for 11, 12, 13
  if (gradeNum >= 11 && gradeNum <= 13) {
    return `${gradeNum}th`;
  }
  
  // Handle based on last digit
  const lastDigit = gradeNum % 10;
  let suffix: string;
  
  switch (lastDigit) {
    case 1:
      suffix = 'st';
      break;
    case 2:
      suffix = 'nd';
      break;
    case 3:
      suffix = 'rd';
      break;
    default:
      suffix = 'th';
  }
  
  return `${gradeNum}${suffix}`;
}