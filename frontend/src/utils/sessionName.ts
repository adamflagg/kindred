/**
 * A session's name, at a stated granularity (kindred#2763).
 *
 *   sessionName(name, sessionType, form)
 *
 * THE ONE ENTRY POINT for rendering a session's name. Before it, fifteen
 * exported functions across `sessionDisplay.ts` and `weekendNames.ts` each
 * shortened a name their own way, and nothing said which one a surface should
 * use: one AG session rendered five ways, one family weekend three. The form
 * is now a closed set, named for its grain, and every rendering call site says
 * which one it prints.
 *
 * ⚠️ CONSOLIDATION ONLY (owner ruling 2026-09-23). Every form reproduces,
 * character for character, what its call sites printed before the move — see
 * `sessionName.pins.test.ts`, which pins each call site's output as literals
 * generated from the old functions. The disparities that preserves (the five
 * AG renderings; the per-form AG detection below; `identity` keeping an adult
 * weekend's "(3 nights)" while `title` drops it) are deliberate, and
 * reconciling them is #2790. Do not "tidy" a rule here without that issue:
 * each one is a rendered string on some surface.
 *
 * The forms, longest first:
 *
 * | form       | example (AG / family / adult)                                              | used by |
 * |------------|----------------------------------------------------------------------------|---------|
 * | `full`     | as CampMinder stores it                                                    | session lists and headers (via the record adapters) |
 * | `identity` | the part before a colon: "Family Camp 5", "Women's Weekend (3 nights)"     | weekend board: title switcher, session list, attribution pills |
 * | `title`    | "Session 2" / "Family Camp 5" / "Women's Weekend"                          | camper journey, siblings |
 * | `short`    | "AG 2 (7-8)" / raw / "Women's Weekend"                                     | camper header chips, metrics drill-downs, forecast |
 * | `matrix`   | "AG Session 2 (7th & 8th)"                                                 | registration availability matrix |
 * | `chart`    | "All-Gender 2 (6-8)", truncated at 25                                      | registration charts and tables |
 * | `tiny`     | "2", "2a", "Taste 2", "Quest" / "FC5" / never abbreviated                  | bunking card and graph last-year line, household journey |
 *
 * `matrix` and `chart` are two forms, not one, because their outputs differ
 * today and the owner ruled to keep both (#2790 decides whether to merge).
 * `identity` is its own form for the same reason: the weekend board's
 * colon-split differs from both the chip (`short`, which leaves a family name
 * whole) and the journey (`title`, which renumbers the 2017-2019 weekends).
 *
 * `tiny` ABBREVIATES ONLY WHAT CAMPMINDER NUMBERED OR THE OWNER MAPPED — the
 * rule `weekendLabel` was built on (kindred#2393), carried to the whole form.
 * An adult program has no tiny form at all until the owner supplies its
 * vocabulary, and reads as its identity whole.
 *
 * Record-level concerns stay OUT of this function: a missing name's fallback
 * ('AG', 'Quest', `null`) and the AG -> parent-session lookup live in the
 * record adapters in `sessionDisplay.ts`, which call this for the name.
 */

import {
  adultWeekendTitle,
  shortWeekendName,
  weekendLabel,
  weekendTitle,
} from '../components/weekend/weekendNames'

/** Every form, longest first. A closed set: add one only with an owner ruling. */
export const SESSION_NAME_FORMS = [
  'full',
  'identity',
  'title',
  'short',
  'matrix',
  'chart',
  'tiny',
] as const

export type SessionNameForm = (typeof SESSION_NAME_FORMS)[number]

/**
 * The programs the rules tables are written per. `taste` is not a
 * session_type — Taste of Camp is a main or embedded session — but two forms
 * have always recognised it by name, so it gets its own row.
 */
type Program = 'main' | 'embedded' | 'taste' | 'ag' | 'quest' | 'teen' | 'family' | 'adult'

type Render = (name: string) => string

/** What an empty name renders as, per form. Checked before any rule. */
const EMPTY: Readonly<Record<SessionNameForm, string>> = {
  full: '',
  identity: '',
  title: 'Unknown Session',
  short: '',
  matrix: '',
  chart: 'Unknown',
  tiny: '',
}

// ---------------------------------------------------------------------------
// Rule helpers — each the body of one old function's branch, unchanged.
// ---------------------------------------------------------------------------

const raw: Render = (name) => name

/** The chart form's cap: past 25 characters, 22 and an ellipsis. */
function truncated(name: string): string {
  return name.length > 25 ? name.slice(0, 22) + '...' : name
}

/** A chart label's grade range — "(Grades 6-8)" or "(6-8)" → " (6-8)". */
function chartGradeRange(name: string): string {
  const gradeMatch = name.match(/\((?:Grades?\s*)?(\d+)[-–](\d+)\)/i)
  return gradeMatch ? ` (${gradeMatch[1]}-${gradeMatch[2]})` : ''
}

/**
 * The name shape the `short` and `matrix` forms read as AG: "gender" anywhere,
 * or a standalone "AG".
 */
function looksAgLoose(name: string): boolean {
  return name.toLowerCase().includes('gender') || /\bag[\s-]/i.test(name)
}

/** The name shape the `title` and `chart` forms read as AG. */
function looksAgStrict(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('all-gender') || lower.includes('ag session')
}

function looksQuest(name: string, sessionType: string | undefined): boolean {
  return sessionType === 'quest' || name.toLowerCase().includes('quest')
}

function looksTaste(name: string): boolean {
  return name.toLowerCase().includes('taste')
}

/**
 * `short` for AG — "AG 2 (7-9)", "AG 4 (6-7)", "AG B". Self-guarding: a name
 * that does not look AG comes back whole, which is what a record typed 'ag'
 * with an unexpected name has always printed.
 */
const agShort: Render = (name) => {
  if (!looksAgLoose(name)) return name
  const sessionId = name.match(/session\s*(\w+)/i)?.[1] ?? ''
  const grades = name.match(/(\d+)\w*\s*[-–&]\s*(\d+)\w*\s*grades?\b/i)
  const gradeRange = grades ? ` (${grades[1]}-${grades[2]})` : ''
  return sessionId ? `AG ${sessionId}${gradeRange}` : `AG${gradeRange}`
}

/**
 * `matrix` for AG — "AG Session 2 (7th & 8th)". Keeps "Session N" and the
 * ordinal grade range, dropping the "All-Gender Cabin-" wrapper and the word
 * "grades": the availability table has the room and staff prefer the explicit
 * form there. Self-guarding like `agShort`.
 */
const agMatrix: Render = (name) => {
  if (!looksAgLoose(name)) return name
  const sessionMatch = name.match(/session\s*(\w+)/i)
  const sessionPart = sessionMatch?.[1] ? `Session ${sessionMatch[1]}` : ''
  const gradeText = name.match(
    /(\d+(?:st|nd|rd|th)?\s*[-–&]\s*\d+(?:st|nd|rd|th)?)\s*grades?/i
  )?.[1]
  const gradeRange = gradeText ? ` (${gradeText.replace(/\s+/g, ' ').trim()})` : ''
  return `AG${sessionPart ? ` ${sessionPart}` : ''}${gradeRange}`
}

const AG_SESSION_NUMBER = [
  /ag\s*session\s*(\d+)/i,
  /all-gender.*session\s*(\d+)/i,
  /session\s*(\d+).*all-gender/i,
]

/** `title` for AG — the parent session it rides on, "Session 2"; else whole. */
const agTitle: Render = (name) => {
  for (const pattern of AG_SESSION_NUMBER) {
    const match = name.match(pattern)
    if (match) return `Session ${match[1]}`
  }
  return name
}

/** `chart` for AG — "All-Gender 2 (6-8)", or "All-Gender" with no number. */
const agChart: Render = (name) => {
  const gradeRange = chartGradeRange(name)
  for (const pattern of [...AG_SESSION_NUMBER, /all-gender.*?(\d+)/i]) {
    const match = name.match(pattern)
    if (match?.[1]) return `All-Gender ${match[1]}${gradeRange}`
  }
  return `All-Gender${gradeRange}`
}

/** `chart` for a summer session — "Session 2", "Session 2a"; else truncated. */
const sessionChart: Render = (name) => {
  const sessionMatch = name.match(/session\s*(\d+[a-z]?)/i)
  if (sessionMatch?.[1]) return `Session ${sessionMatch[1]}${chartGradeRange(name)}`
  return truncated(name)
}

/**
 * `chart` for embedded — the first lettered session number ("Session 2a"),
 * else the summer rule. Kept apart from `sessionChart` because the two
 * regexes pick different matches when a name holds more than one session.
 */
const embeddedChart: Render = (name) => {
  const embeddedMatch = name.match(/session\s*(\d+[a-z])/i)
  if (embeddedMatch?.[1]) return `Session ${embeddedMatch[1]}${chartGradeRange(name)}`
  return sessionChart(name)
}

/**
 * `tiny` for a summer session — "2", "2a"; then any number; then the first
 * word. (The old function also had an AG branch after the "Session N" match;
 * every one of its patterns contains "session N", so the match above always
 * won and the branch never ran. AG's tiny IS this rule.)
 */
const sessionNumber: Render = (name) => {
  const sessionMatch = name.match(/Session\s*(\d+[a-z]?)/i)?.[1]
  if (sessionMatch) return sessionMatch
  const numberMatch = name.match(/(\d+[a-z]?)/)?.[1]
  if (numberMatch) return numberMatch
  return name.split(' ')[0] ?? name
}

/**
 * `tiny` for Taste of Camp — "Taste 2" for a split cohort, else "Taste". The
 * 1-2 digit match (with a space before it) keeps a 4-digit year suffix from
 * reading as a cohort.
 */
const tasteTiny: Render = (name) => {
  const cohortMatch = name.match(/\s(\d{1,2})\s*$/)
  return cohortMatch ? `Taste ${cohortMatch[1]}` : 'Taste'
}

// ---------------------------------------------------------------------------
// The rules tables — one per program.
// ---------------------------------------------------------------------------

/** What every summer program prints unless its own table says otherwise. */
const SUMMER_MAIN: Readonly<Record<SessionNameForm, Render>> = {
  full: raw,
  identity: shortWeekendName,
  title: raw,
  short: raw,
  matrix: raw,
  chart: sessionChart,
  tiny: sessionNumber,
}

const RULES: Readonly<Record<Program, Readonly<Record<SessionNameForm, Render>>>> = {
  main: SUMMER_MAIN,
  embedded: { ...SUMMER_MAIN, chart: embeddedChart },
  taste: { ...SUMMER_MAIN, chart: raw, tiny: tasteTiny },
  ag: { ...SUMMER_MAIN, title: agTitle, short: agShort, matrix: agMatrix, chart: agChart },
  quest: { ...SUMMER_MAIN, chart: truncated, tiny: () => 'Quest' },
  // SCIT and TLI have never had a rule of their own in any form.
  teen: SUMMER_MAIN,
  // The weekend rules live in `weekendNames.ts`, beside the slug the tiny
  // label is built from. `short` leaves a family name whole: that is what the
  // camper chip has always printed for one.
  family: { ...SUMMER_MAIN, title: weekendTitle, tiny: weekendLabel },
  // No tiny vocabulary for adult programs (owner, 2026-09-23): the identity,
  // never an abbreviation — not even of a number, as a family weekend's is.
  adult: {
    ...SUMMER_MAIN,
    title: adultWeekendTitle,
    short: adultWeekendTitle,
    tiny: shortWeekendName,
  },
}

/** The program a session_type names, before any form reads the name. */
function programOfType(sessionType: string | undefined): Program {
  switch (sessionType) {
    case 'embedded':
    case 'ag':
    case 'quest':
    case 'family':
    case 'adult':
      return sessionType
    case 'scit':
    case 'tli':
      return 'teen'
    default:
      return 'main'
  }
}

/**
 * Which program's rule a form applies.
 *
 * ⚠️ PER FORM, because the old functions each detected AG, Quest and Taste of
 * Camp their own way, and in their own order — and the output depends on it.
 * Unifying these is #2790's to decide, not a refactor's.
 */
const PROGRAM_FOR: Readonly<
  Record<SessionNameForm, (name: string, sessionType: string | undefined) => Program>
> = {
  full: (_name, sessionType) => programOfType(sessionType),
  identity: (_name, sessionType) => programOfType(sessionType),
  title: (name, sessionType) => {
    if (sessionType === 'family' || sessionType === 'adult') return sessionType
    if (sessionType === 'ag' || looksAgStrict(name)) return 'ag'
    return programOfType(sessionType)
  },
  // Infers AG from the name ONLY when no type was given at all: the metrics
  // rows carry none and always have, while a session record is taken at its
  // word.
  short: (name, sessionType) => {
    if (sessionType === 'ag' || (sessionType === undefined && looksAgLoose(name))) return 'ag'
    return programOfType(sessionType)
  },
  matrix: (name, sessionType) => (looksAgLoose(name) ? 'ag' : programOfType(sessionType)),
  chart: (name, sessionType) => {
    if (looksQuest(name, sessionType)) return 'quest'
    if (looksTaste(name)) return 'taste'
    if (sessionType === 'ag' || looksAgStrict(name)) return 'ag'
    return sessionType === 'embedded' ? 'embedded' : 'main'
  },
  tiny: (name, sessionType) => {
    if (sessionType === 'family' || sessionType === 'adult') return sessionType
    if (looksQuest(name, sessionType)) return 'quest'
    if (looksTaste(name)) return 'taste'
    return 'main'
  },
}

/**
 * A session's name at the given granularity.
 *
 * @param name The session's name as CampMinder stores it.
 * @param sessionType Its `session_type`, or `undefined` when the caller has
 *   none at all (the metrics rows) — which the `short` form reads as "infer
 *   AG from the name". A record with no type should pass `''`, not undefined.
 * @param form Which granularity; see the table at the top of this file.
 */
export function sessionName(
  name: string,
  sessionType: string | undefined,
  form: SessionNameForm
): string {
  if (!name) return EMPTY[form]
  return RULES[PROGRAM_FOR[form](name, sessionType)][form](name)
}
