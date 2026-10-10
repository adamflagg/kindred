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
 * ⚠️ #2763 WAS CONSOLIDATION ONLY (owner ruling 2026-09-23): every form
 * reproduced, character for character, what its call sites printed before the
 * move — see `sessionName.pins.test.ts`. #2790's owner vocabulary ruling
 * (2026-10-09) is the first deliberate change on top of that: it sets the
 * `tiny` and `short` vocabularies (S2, AG 2, WW, NW Canada, BM1 EB, "Hebrew 1
 * · Wed 4pm", ...). `full`, `identity`, `title`, `matrix` and `chart` are
 * untouched. The disparities that remain (the five AG renderings; the per-form
 * AG detection below; `identity` keeping an adult weekend's "(3 nights)" while
 * `title` drops it) are still #2790's open items. Do not "tidy" a rule here
 * without the owner: each one is a rendered string on some surface.
 *
 * The forms, longest first:
 *
 * | form       | example (AG / family / adult)                                              | used by |
 * |------------|----------------------------------------------------------------------------|---------|
 * | `full`     | as CampMinder stores it                                                    | session lists and headers (via the record adapters) |
 * | `identity` | the part before a colon: "Family Camp 5", "Women's Weekend (3 nights)"     | weekend board: title switcher, session list, attribution pills |
 * | `title`    | "Session 2" / "Family Camp 5" / "Women's Weekend"                          | camper journey, siblings |
 * | `short`    | "AG 2 (7-8)" / "Family Camp 5" (no subtitle) / "Women's Weekend"; "B*Mitzvah Y1 East Bay", "Hebrew 1 · Wed 4pm", "Family School EB" | camper header chips, metrics drill-downs, forecast |
 * | `matrix`   | "AG Session 2 (7th & 8th)"                                                 | registration availability matrix |
 * | `chart`    | "All-Gender 2 (6-8)", truncated at 25                                      | registration charts and tables |
 * | `tiny`     | "S2", "S2a", "Taste 2", "AG 2", "NW Canada" / "FC5" / "WW", "MW"           | bunking card and graph last-year line, household journey |
 *
 * `matrix` and `chart` are two forms, not one, because their outputs differ
 * today and the owner ruled to keep both (#2790 decides whether to merge).
 * `identity` is its own form for the same reason: the weekend board's
 * colon-split differs from both the chip (`short`, which leaves a family name
 * whole) and the journey (`title`, which renumbers the 2017-2019 weekends).
 *
 * `tiny` ABBREVIATES ONLY WHAT CAMPMINDER NUMBERED OR THE OWNER MAPPED — the
 * rule `weekendLabel` was built on (kindred#2393), carried to the whole form.
 * The owner's 2026-10-09 ruling (#2790) is the mapping: the named quests, WW
 * and MW, BM1 EB, Heb 1, TFS EB, CIT, SIT, TLI, TWR, Staff Kids, Board and Gold
 * Rush. A name no mapping covers — an unmapped quest, any other adult program,
 * a B*Mitzvah region the ruling did not name — reads as its identity whole
 * (the part before a colon), never an abbreviation of it.
 *
 * Record-level concerns stay OUT of this function: a missing name's fallback
 * ('AG', 'Quest', `null`) and the AG -> parent-session lookup live in the
 * record adapters in `sessionDisplay.ts`, which call this for the name.
 */

import {
  adultWeekendLabel,
  adultWeekendTitle,
  familyShortName,
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
type Program =
  | 'main'
  | 'embedded'
  | 'taste'
  | 'ag'
  | 'quest'
  | 'teen'
  | 'family'
  | 'adult'
  | 'bmitzvah'
  | 'hebrew'
  | 'school'
  | 'other'

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
 * `tiny` for a summer session — "S2", "S2a" (#2790; was the bare "2"); then
 * any number; then the first word. The "S" goes only on a "Session N" match:
 * a bare number pulled out of some other name is not a session number.
 */
const sessionNumber: Render = (name) => {
  const sessionMatch = name.match(/Session\s*(\d+[a-z]?)/i)?.[1]
  if (sessionMatch) return `S${sessionMatch}`
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

/**
 * `short` for a quest — the name with CampMinder's quirks read as the camp means them: the digit
 * zero in "H20" is the letter O, and the backticks round "n" in "Surf `n` Turf" are dropped.
 */
const questShort: Render = (name) => name.replace(/\bH20\b/g, 'H2O').replace(/`n`/g, 'n')

/** `tiny` for AG (#2790) — "AG 2", "AG B": the AG session's own number. */
const agTiny: Render = (name) => {
  const sessionId = name.match(/session\s*(\w+)/i)?.[1]
  return sessionId ? `AG ${sessionId}` : 'AG'
}

/** A name's identity — the part before a colon. What an unmapped name reads as. */
const whole: Render = (name) => shortWeekendName(name)

/**
 * A mapping key: the identity with a trailing parenthetical dropped, lowercased,
 * punctuation gone — so "Surf `n` Turf Quest" and "Teen Winter Retreat
 * (December)" find their entries, and nothing keys on the camp's own name.
 */
function mapKey(name: string): string {
  return adultWeekendTitle(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** A tiny map lookup; an unmapped name reads whole, never invented. */
function mapped(map: Readonly<Record<string, string>>): Render {
  return (name) => map[mapKey(name)] ?? whole(name)
}

/** The quests the owner named (2026-10-09, #2790). An unmapped quest reads whole. */
const questTiny = mapped({
  northwestcanadaquest: 'NW Canada',
  questh20: 'H2O',
  rockandriverquest: 'Rock & River',
  sierraslamquest: 'Sierra Slam',
  surfnturfquest: 'Surf n Turf',
  tasteofquest: 'Taste Quest',
})

/**
 * CIT, SIT, TLI and TWR (owner, 2026-10-09, #2790). An unmapped name reads
 * whole INCLUDING its colon part: "TLI: Camp to Portland" cut at the colon
 * would be "TLI" — the mapped label, for a different session.
 */
const TEEN_TINY: Readonly<Record<string, string>> = {
  counselorintraining: 'CIT',
  specialistintraining: 'SIT',
  teenleadershipinstitute: 'TLI',
  teenwinterretreat: 'TWR',
}
const teenTiny: Render = (name) => TEEN_TINY[mapKey(name)] ?? name.trim()

/** "Year 1" / "Year 2" of a B*Mitzvah name. */
function bmitzvahYear(name: string): string | undefined {
  return name.match(/\byear\s*([12])\b/i)?.[1]
}

/** The two regions the owner named for B*Mitzvah and Family School. */
function region(
  name: string
): { abbr: 'EB' | 'SF'; words: 'East Bay' | 'San Francisco' } | undefined {
  // The cohort after the dash names the region ("Family School - San Francisco cohort"), even when
  // the rest of the name mentions the other one; else the first region word anywhere.
  const named =
    name.match(/[-–]\s*(east bay|san francisco)\b/i)?.[1] ??
    name.match(/east bay|san francisco/i)?.[0]
  if (named === undefined) return undefined
  return /east bay/i.test(named)
    ? { abbr: 'EB', words: 'East Bay' }
    : { abbr: 'SF', words: 'San Francisco' }
}

/** `tiny` for B*Mitzvah — "BM1 EB". Needs both a ruled year and region. */
const bmitzvahTiny: Render = (name) => {
  const year = bmitzvahYear(name)
  const where = region(name)
  return year && where ? `BM${year} ${where.abbr}` : whole(name)
}

/** `short` for B*Mitzvah — "B*Mitzvah Y1 East Bay". Else whole, as before. */
const bmitzvahShort: Render = (name) => {
  const year = bmitzvahYear(name)
  const where = region(name)
  return year && where ? `B*Mitzvah Y${year} ${where.words}` : name
}

/** `tiny` for Hebrew — "Heb 1". */
const hebrewTiny: Render = (name) => {
  const number = name.match(/^\s*hebrew\s+(\d+)/i)?.[1]
  return number ? `Heb ${number}` : whole(name)
}

/**
 * `short` for Hebrew — "Hebrew 1 · Wed 4pm", from the record's own day and
 * time words ("Hebrew 1 - Wednesdays at 4pm"). A day is cut to its three-letter
 * weekday; the time is kept verbatim. A name without both prints whole.
 */
const hebrewShort: Render = (name) => {
  const match = name.match(
    /^\s*(hebrew\s+\d+)\s*[-–]\s*(mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)days?\s+at\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i
  )
  if (!match) return name
  const day = (match[2] ?? '').slice(0, 3)
  return `${match[1]} · ${day.charAt(0).toUpperCase()}${day.slice(1).toLowerCase()} ${match[3]}`
}

/** `tiny` for Family School — "TFS EB" / "TFS SF". */
const schoolTiny: Render = (name) => {
  const where = region(name)
  return where ? `TFS ${where.abbr}` : whole(name)
}

/** `short` for Family School — "Family School EB" / "Family School SF". */
const schoolShort: Render = (name) => {
  const where = region(name)
  return where ? `Family School ${where.abbr}` : name
}

/** `tiny` for the "other" programs (owner, 2026-10-09, #2790). */
const otherTiny: Render = (name) => {
  const key = mapKey(name)
  if (key === 'staffkids' || key === 'staffkidsatcamp') return 'Staff Kids'
  if (key === 'goldrush') return 'Gold Rush'
  // "{camp} Board": the word closes the name, so "Board Game Weekend" is not it.
  if (/(^|\s)board$/i.test(adultWeekendTitle(name))) return 'Board'
  return whole(name)
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
  ag: {
    ...SUMMER_MAIN,
    title: agTitle,
    short: agShort,
    matrix: agMatrix,
    chart: agChart,
    tiny: agTiny,
  },
  quest: { ...SUMMER_MAIN, chart: truncated, short: questShort, tiny: questTiny },
  // SCIT, TLI and Teen Winter Retreat: only `tiny` has a rule (#2790).
  teen: { ...SUMMER_MAIN, tiny: teenTiny },
  bmitzvah: { ...SUMMER_MAIN, short: bmitzvahShort, tiny: bmitzvahTiny },
  hebrew: { ...SUMMER_MAIN, short: hebrewShort, tiny: hebrewTiny },
  school: { ...SUMMER_MAIN, short: schoolShort, tiny: schoolTiny },
  other: { ...SUMMER_MAIN, tiny: otherTiny },
  // The weekend rules live in `weekendNames.ts`, beside the slug the tiny
  // label is built from. `short` is the number without its theme (#2790): a
  // weekend's theme moves between numbers year to year.
  family: { ...SUMMER_MAIN, title: weekendTitle, short: familyShortName, tiny: weekendLabel },
  // Adult tiny: only Women's / Men's Weekend are mapped (WW / MW, #2790); any
  // other adult program reads as its identity, never an abbreviation.
  adult: {
    ...SUMMER_MAIN,
    title: adultWeekendTitle,
    short: adultWeekendTitle,
    tiny: adultWeekendLabel,
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
    case 'bmitzvah':
    case 'hebrew':
    case 'school':
    case 'other':
    case 'teen':
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
    if (
      sessionType === 'bmitzvah' ||
      sessionType === 'hebrew' ||
      sessionType === 'school' ||
      sessionType === 'other'
    ) {
      return sessionType
    }
    if (sessionType === 'scit' || sessionType === 'tli' || sessionType === 'teen') return 'teen'
    if (looksQuest(name, sessionType)) return 'quest'
    if (looksTaste(name)) return 'taste'
    // The bunking graph passes no type; its AG names read AG like `short`'s do.
    if (sessionType === 'ag' || (sessionType === undefined && looksAgStrict(name))) return 'ag'
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
