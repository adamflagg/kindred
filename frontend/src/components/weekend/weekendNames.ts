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
 * qualifier for the row that has space, and is lossless.
 *
 * Names without a colon ("Women's Weekend", "Ready, Set, Camp", "JFAM Winter
 * Family Camp") are already short and pass through untouched.
 *
 * ★ THREE FORMS, AND WHICH ONE A SURFACE MAY USE IS NOT A STYLE CHOICE:
 *
 * * `splitWeekendName` / `shortWeekendName` — the default. Lossless, and what
 *   every title, picker and tab with room prints.
 * * `weekendSlug` — an ADDRESS for a URL. Never rendered.
 * * `weekendLabel` — an abbreviation, `FC1`, for a surface with no room for a
 *   name. Owner-ruled on 2026-08-18 (kindred#2393) for the family journey
 *   panel, which is 416px wide and must fit up to four weekends on one line.
 *   It is a narrow licence and not a general one, in two senses: reach for
 *   `shortWeekendName` unless the space genuinely will not take it, and note
 *   that `weekendLabel` ITSELF only abbreviates a weekend CampMinder numbered.
 *   A prose name comes back whole, because an invented abbreviation is how a
 *   UI starts disagreeing with CampMinder about what a session is called —
 *   `FFCI` for "Fall Family Camp II" is that, on the screen.
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
 * A URL, first and foremost: `/weekend/fc1/map` is one staff can say out loud
 * where `/weekend/1000001/map` is not.
 *
 * ⚠️ NOT A LABEL BY ITSELF — render `weekendLabel`, never this. This function
 * returns '' for a weekend it cannot address, which is the right answer for a
 * URL and a blank on a screen; `weekendLabel` is the display wrapper that
 * uppercases the slug and falls back to the weekend's own short name when
 * there is none. (Until 2026-08-18 this comment forbade display use outright.
 * The owner's kindred#2393 ruling granted the narrow licence the top-of-file
 * note now describes, and the wrapper is where it lives — a doc block that
 * forbids what the code beside it does is worse than either rule alone.)
 *
 * Initials of the identity, with a trailing number kept whole — "Family Camp
 * 10" must not collide with "Family Camp 1". Read from the identity only, so
 * the description after the colon cannot drag every JFAM weekend onto one slug.
 *
 * Returns '' when a name has nothing to abbreviate INTO AN ADDRESS. Callers
 * must treat that as "not addressable" rather than as a slug; `weekendRef`
 * does.
 */
/**
 * The identity, as the words an abbreviation is built from.
 *
 * Shared by `weekendSlug` and `weekendLabel` so the two cannot drift about
 * what a "word" is — the label's decision to abbreviate at all reads the same
 * final word the slug's trailing-number rule does.
 */
function identityWords(name: string): string[] {
  return (
    shortWeekendName(name)
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
  )
}

export function weekendSlug(name: string): string {
  const words = identityWords(name)

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

/**
 * A weekend as `FC1`, for a surface with no room for its name (kindred#2393).
 *
 * The owner's 2026-08-18 ruling, settled against full-width mockups: the
 * family journey panel is `w-[26rem]` = 416px, a household-year can carry up
 * to four weekends, and "Family Camp 1: Memorial Day Weekend" four times over
 * is not a line — `FC1 · FC4 · FC5` is. PLAIN TEXT, not a chip and not a
 * badge: the row already carries a housing name, a "No enrollment" chip and a
 * "See members" action, and a fourth decorated element makes none of them
 * readable.
 *
 * Uppercased, because the slug is lowercase for a URL and `fc1` on a screen
 * reads as a typo.
 *
 * ⚠️ ONLY A WEEKEND CAMPMINDER NUMBERED IS ABBREVIATED. `FC1` is safe because
 * the number IS the weekend's identity — the abbreviation cannot name a
 * different weekend, and it is the form staff already say out loud. Nothing
 * supplies that guarantee for a prose name, so those print in full and the
 * top-of-file note's argument stands unamended for them.
 *
 * That is not a stylistic hedge, it is measured. Initials alone give both
 * "Spring Family Camp" and "Summer Family Camp" the label `SFC`, and collapse
 * "Fall Family Camp I", "II" and "III" onto `FFCI` — so a 2018 journey row for
 * a family that went to Fall II would have read as Fall I. All three names are
 * live in the 2017-2019 seasons the journey renders: 891 of 3,040
 * single-weekend household-years sit in one, and 5 of the 64 multi-weekend
 * ones would have printed one label twice on a single line and offered two
 * members-modal tabs nobody could tell apart. Under this rule every season in
 * the catalogue, 2017 through 2026, labels its weekends distinctly.
 *
 * ⚠️ Falls back to `shortWeekendName`, NEVER to the CampMinder id. `weekendRef`
 * falls back to the id because a URL must resolve; a label must be readable,
 * and `1000005` names nothing a staff member recognises. That is also why this
 * takes a name and not a session: it structurally cannot emit an id.
 */
export function weekendLabel(name: string): string {
  const words = identityWords(name)
  // The SAME final word `weekendSlug`'s trailing-number rule keeps whole. A
  // lone number is not a numbered weekend, it is a year ("2026"), and there is
  // no identity in front of it to abbreviate.
  const isNumbered = words.length > 1 && DIGITS_ONLY.test(words[words.length - 1] ?? '')
  const slug = isNumbered ? weekendSlug(name) : ''
  return slug.length > 0 ? slug.toUpperCase() : shortWeekendName(name)
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
