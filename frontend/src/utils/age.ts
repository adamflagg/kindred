/**
 * Format age from CampMinder format to display format
 * @param age - Age in CampMinder format (e.g., 11.06 for 11 years 6 months)
 * @returns Formatted age string
 */
export function formatAge(age: number): string {
  // Extract years and months from CampMinder format
  const years = Math.floor(age);
  const months = Math.round((age - years) * 100);
  
  // Return in format "11 years, 6 months"
  if (months === 0) {
    return `${years} years`;
  }
  return `${years} years, ${months} month${months === 1 ? '' : 's'}`;
}

/**
 * Display age in CampMinder format with proper rounding
 * @param age - Age in CampMinder format
 * @returns Age string with 2 decimal places
 */
export function displayCampMinderAge(age: number): string {
  // Ensure we always show 2 decimal places and avoid floating point issues
  return age.toFixed(2);
}