/**
 * Calculate age in years with fractional months (e.g., 12.07 for 12 years 7 months)
 * @param birthdate - Date string in format YYYY-MM-DD
 * @returns Age in years with fractional months (e.g., 12.07)
 */
export function calculateAge(birthdate: string): number {
  const today = new Date();
  const birth = new Date(birthdate);
  
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  
  if (months < 0 || (months === 0 && today.getDate() < birth.getDate())) {
    years--;
    months += 12;
  }
  
  if (today.getDate() < birth.getDate()) {
    months--;
    if (months < 0) {
      months = 11;
    }
  }
  
  return years + (months / 100);
}