/**
 * Weekend display names.
 *
 * CampMinder's names carry two things at once — the weekend's identity and
 * what it is, joined by a colon:
 *
 *   "Family Camp 1: Memorial Day Weekend"
 *   "Family Camp 5: JFAM Weekend (w/ kids 10 and under)"
 *
 * Rendering the whole string everywhere makes a picker unreadable and a title
 * wrap. Splitting on the colon gives a short identity for compact places and a
 * qualifier for the row that has space, and is lossless — unlike inventing
 * abbreviations, which is how a UI starts disagreeing with CampMinder about
 * what a session is called.
 *
 * Names without a colon ("Women's Weekend", "Ready, Set, Camp", "JFAM Winter
 * Family Camp") are already short and pass through untouched.
 */

export interface WeekendName {
  /** Compact identity for titles, pickers, tabs. */
  short: string
  /** What it is, when the name carried that separately. May be empty. */
  qualifier: string
}

export function splitWeekendName(name: string): WeekendName {
  const colon = name.indexOf(':')
  if (colon === -1) return { short: name.trim(), qualifier: '' }

  const short = name.slice(0, colon).trim()
  const qualifier = name.slice(colon + 1).trim()
  // A leading colon, or nothing before it, means the split would lose the
  // name rather than shorten it.
  if (short.length === 0) return { short: name.trim(), qualifier: '' }
  return { short, qualifier }
}

/** The compact form alone — for titles and pickers. */
export function shortWeekendName(name: string): string {
  return splitWeekendName(name).short
}
