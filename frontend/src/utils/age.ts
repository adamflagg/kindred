/**
 * At 21 and over, the DISPLAY drops the months: "37.11" reads "37" (owner
 * ruling 2026-09-22, cutoff raised from 18 to 21: teens 18-20 are still
 * campers in summer and teen programs, so the owner wants 21 "to be safe").
 * CampMinder itself keeps them — most 21+ ages carry a fraction — so this is
 * a display choice, not a property of the data. Comparing the raw yy.mm with
 * `age >= ADULT_AGE` is safe because the months never exceed `.11`: 20.11
 * stays below 21. Still CampMinder's own value — never derived from birthdate
 * (#2088). Applied here so every surface inherits it.
 *
 * The camper journey's adulthood gate (whether a viewer sees their household's
 * family weekends) reads the same cutoff on the server since kindred#2776 —
 * `ADULT_AGE` in `api/services/camper_journey_service.py`. Two copies of one
 * number are how the two would drift the next time this cutoff moves, so a
 * pytest reads this line and holds the server's equal to it.
 */
export const ADULT_AGE = 21

/**
 * Format age from CampMinder format to display format
 * @param age - Age in CampMinder format (e.g., 11.06 for 11 years 6 months)
 * @returns Formatted age string
 */
export function formatAge(age: number): string {
  // Extract years and months from CampMinder format
  const years = Math.floor(age)
  if (age >= ADULT_AGE) return `${years} years`
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
  if (age >= ADULT_AGE) return String(Math.trunc(age))
  // Ensure we always show 2 decimal places and avoid floating point issues
  return age.toFixed(2)
}

/**
 * Whole-year age, TRUNCATED not rounded — for the board's compact family
 * card (kindred#2074), which leads with the campers' ages at a glance.
 *
 * `persons.age` is CampMinder's yy.mm as a raw float, encoded so months never
 * exceed `.11` — a fraction that, taken on its own, always rounds DOWN
 * (`Math.round(6.11)` is `6`, same as `Math.trunc`). `Math.trunc` is still
 * required, not a style choice: it matches "completed years", the semantics
 * the yy.mm format intends, rather than "nearest year" — a distinction this
 * format's current range happens to hide, but a genuinely different
 * computation (e.g. converting months to a true year-fraction, `6 + 11/12`,
 * before rounding) would not. Trust the intent, not the coincidence.
 *
 * This is deliberately a SECOND renderer beside `displayCampMinderAge`, not
 * a shared one. The detail panel still needs the full `(Y)Y.MM` precision;
 * only the card's compact line truncates — CLAUDE.md §4's "model summer's
 * primitives" rule is why that divergence needs saying: summer's equivalent
 * compact card (`CamperCard.tsx`) shows the full `displayCampMinderAge` precision.
 * Here the card is deliberately terser because age is the entire point of a
 * "similar ages" match at a glance across up to 62 simultaneous cards, where
 * the extra digits of `(Y)Y.MM` cost more legibility than they buy —
 * precision that stays one click away, unchanged, on the detail panel.
 */
export function displayTruncatedAge(age: number): string {
  return String(Math.trunc(age))
}
