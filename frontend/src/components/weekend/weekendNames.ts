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

/**
 * Program tokens that appear across many weekends.
 *
 * They say what KIND of weekend it is, never which one, so they are noise in
 * an address — a slug's whole job is to tell two weekends apart. A hardcoded
 * constant rather than a config row: it changes about as often as the camp's
 * program lineup does, and a PR is the right amount of ceremony for that.
 *
 * Matched case-insensitively against whole words, so a weekend named only by
 * a shared token still slugs to something (see `weekendSlug`).
 */
const SHARED_PROGRAM_TOKENS = new Set(['jfam'])

/**
 * A run of digits and nothing else — the shape `resolveWeekendRef` reads as a
 * CampMinder id. A slug that matches this is not distinguishable from one.
 */
const DIGITS_ONLY = /^\p{N}+$/u

function initials(words: string[]): string {
  return words
    .map((word, index) => {
      // The trailing number is the identity — "Family Camp 1" is fc1, not fc1
      // truncated from something. Only at the end: a number in the middle is
      // part of a description that got this far.
      const isLast = index === words.length - 1
      if (isLast && DIGITS_ONLY.test(word)) return word
      return word.slice(0, 1)
    })
    .join('')
    .toLowerCase()
}

/**
 * A weekend's ADDRESS: `fc1`, `ww`, `mw`, `rsc`.
 *
 * THIS IS NOT A DISPLAY NAME, and the distinction is the whole reason it is
 * allowed to exist. The note at the top of this file argues against inventing
 * abbreviations because a UI that does starts disagreeing with CampMinder
 * about what a session is CALLED — every title, picker and tab still renders
 * `splitWeekendName`'s output verbatim. A URL is not a label; it is how staff
 * type and share a weekend, and `/weekend/fc1/map` is one they can say out
 * loud where `/weekend/1000001/map` is not.
 *
 * Initials of the identity, with a trailing number kept whole — "Family Camp
 * 10" must not collide with "Family Camp 1". Read from the identity only, so
 * the description after the colon cannot drag every JFAM weekend onto one slug.
 *
 * Returns '' when a name has nothing to abbreviate INTO AN ADDRESS. Callers
 * must treat that as "not addressable" rather than as a slug; `weekendRef`
 * does.
 */
export function weekendSlug(name: string): string {
  const words = shortWeekendName(name)
    // An apostrophe sits INSIDE a word, so it is deleted rather than treated as
    // a separator. Splitting on it turns "Women's Weekend" into three words and
    // slugs it `wsw`.
    .replace(/['’]/g, '')
    // Every other mark IS a separator: "Ready, Set, Camp" is three words.
    // Digits survive because they are the identity.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)

  const meaningful = words.filter((word) => !SHARED_PROGRAM_TOKENS.has(word.toLowerCase()))
  const dropped = initials(meaningful)
  // A weekend named ONLY by shared tokens keeps them: a slug of '' would make
  // it unaddressable, which is worse than one that reads oddly. The SAME
  // escape hatch covers a slug left as bare digits — "JFAM 10" without its
  // token is `10`, which `resolveWeekendRef` reads as a CampMinder id, so the
  // URL would not resolve back to the weekend that emitted it. Keeping the
  // token gives `j10`, which does.
  const slug = meaningful.length > 0 && !DIGITS_ONLY.test(dropped) ? dropped : initials(words)

  // Nothing but digits to work with even then: the numeric space belongs to
  // CampMinder ids, so this weekend has no address of its own to offer.
  return DIGITS_ONLY.test(slug) ? '' : slug
}

/** The minimum a weekend must carry to be addressed. */
export interface AddressableWeekend {
  session_cm_id: number
  name: string
}

/**
 * What to put in a URL for this weekend.
 *
 * The slug when it is unique among the weekends given, and the CampMinder id
 * when it is not — or when `weekendSlug` declines to give one at all. An
 * ambiguous slug that resolved to whichever row sorted first would open the
 * WRONG weekend, and a URL that lies about which weekend you are looking at is
 * worse than an ugly one.
 *
 * Whatever this emits, `resolveWeekendRef` must read back as the same weekend.
 */
export function weekendRef(session: AddressableWeekend, sessions: AddressableWeekend[]): string {
  const slug = weekendSlug(session.name)
  if (slug.length === 0) return String(session.session_cm_id)
  const sharing = sessions.filter((other) => weekendSlug(other.name) === slug)
  return sharing.length === 1 ? slug : String(session.session_cm_id)
}

/**
 * The weekend a URL reference names, by slug or by CampMinder id.
 *
 * Undefined rather than a guess when a slug is ambiguous — the same judgement
 * `weekendRef` makes when it declines to emit one.
 */
export function resolveWeekendRef(
  sessions: AddressableWeekend[],
  ref: string | undefined
): AddressableWeekend | undefined {
  if (ref === undefined || ref.length === 0) return undefined

  // The same shape `weekendSlug` refuses to emit, so a slug can never land
  // here and be mistaken for an id.
  if (DIGITS_ONLY.test(ref)) {
    const id = Number(ref)
    return sessions.find((session) => session.session_cm_id === id)
  }

  const matches = sessions.filter((session) => weekendSlug(session.name) === ref.toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}
