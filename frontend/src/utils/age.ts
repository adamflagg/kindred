/**
 * Format age from CampMinder format to display format
 * @param age - Age in CampMinder format (e.g., 11.06 for 11 years 6 months)
 * @returns Formatted age string
 */
export function formatAge(age: number): string {
  // Extract years and months from CampMinder format
  const years = Math.floor(age)
  const months = Math.round((age - years) * 100)

  // Return in format "11 years, 6 months"
  if (months === 0) {
    return `${years} years`
  }
  return `${years} years, ${months} month${months === 1 ? '' : 's'}`
}

/**
 * Display age in CampMinder format with proper rounding
 * @param age - Age in CampMinder format
 * @returns Age string with 2 decimal places
 */
export function displayCampMinderAge(age: number): string {
  // Ensure we always show 2 decimal places and avoid floating point issues
  return age.toFixed(2)
}

/**
 * Whole-year age, TRUNCATED not rounded — for the board's compact family
 * card (kindred#2074), which leads with the campers' ages at a glance.
 *
 * `persons.age` is CampMinder's yy.mm as a raw float, and months never
 * exceed `.11`. That means `Math.round` (or `toFixed(0)`) tips a child of
 * `6.11` — six years, eleven months — up to `7`, which is simply wrong: they
 * are not seven until the month field rolls to `.12`/`1.00`. `Math.trunc` is
 * required here, not a style choice.
 *
 * This is deliberately a SECOND renderer beside `displayCampMinderAge`, not
 * a shared one. The detail panel still needs the full `(Y)Y.MM` precision;
 * only the card's compact line truncates. Do not unify them.
 */
export function displayTruncatedAge(age: number): string {
  return String(Math.trunc(age))
}
