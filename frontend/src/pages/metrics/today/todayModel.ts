/**
 * Analytics › Today (#3207 PR 8): the page's pure model, kept apart from the cards so every rule the owner
 * ruled is pinned by a unit test (todayModel.test.ts).
 */
import type { DefinitionNote } from '../../../components/camperships/kit/DefinitionNotes'
import type {
  ApiTodayPacePoint,
  ApiTodayPriorPart,
  ApiTodaySessionRow,
  ApiTodaySessions,
} from '../../../types/api-types'
import { PRIORITY_DAY_NOTE } from '../../../utils/priorityDay'

/**
 * PM-8 A: Today compares with last year at the same registration day all year and never with its
 * final. 'none' is the one exception: a season with no anchor has no same day, so no comparison.
 */
export type PriorBasis = 'same_point' | 'none'
export type FillBasis = 'plan' | 'goal'

/**
 * Every change on the page says what it compares with: always the same point, all year. With no
 * same day ('none') it says "no comparison" and the "vs" headers are hidden (owner call 2026-10-26):
 * never another year's date in its place.
 */
export function basisWords(basis: PriorBasis, priorYear: number): string {
  return basis === 'same_point' ? `vs same point ${String(priorYear)}` : 'no comparison'
}

/** The page's basis from a compare answer: the same point, or none when there is no day to read. */
export function priorBasisOf(prior: { prior_basis?: string | null } | undefined): PriorBasis {
  return prior?.prior_basis === 'unavailable' || prior?.prior_basis === null ? 'none' : 'same_point'
}

/** "Registration day 91" (the priority date is day 1), or the days before it, or nothing without an anchor. */
export function registrationDayWords(
  dayOffset: number | null | undefined,
  priorityLabel: string | null
): string | null {
  if (dayOffset == null) return null
  if (dayOffset < 0) {
    return priorityLabel ? `Before priority registration, which opens ${priorityLabel}` : null
  }
  if (dayOffset === 0) return 'Priority registration, day 1'
  return `Registration day ${String(dayOffset + 1)}`
}

/** One Session fill row: a session, or one cabin group of the one session the scope picks. */
export interface FillRow {
  readonly key: string
  readonly name: string
  readonly sessionCmId: number
  readonly sessionType: string
  readonly enrolled: number
  readonly waitlisted: number
  readonly beds: number | null
  readonly goal: number | null
  /** A cabin group: its session's goal is set per session, not per group. */
  readonly goalPerSession: boolean
  /** Last year's figure from the session's own match (ruling #15); null when nothing matched. */
  readonly prior: number | null
  /** PR 8b: the breakdown when embedded sessions folded into `prior`, the main session first. */
  readonly priorParts: readonly ApiTodayPriorPart[] | null
  readonly parts: ApiTodaySessionRow['parts']
}

const PART_NAMES: Record<string, string> = { Girls: 'Girls', Boys: 'Boys', AG: 'AG cabins' }

/** The table's rows: each session, or, for a one-session scope, that session's cabin groups (the mock). */
export function scopeRows(rows: readonly ApiTodaySessionRow[], oneSession: boolean): FillRow[] {
  const only = rows[0]
  if (oneSession && rows.length === 1 && only && only.parts.length > 1) {
    return only.parts.map((p) => ({
      key: `${String(only.session_cm_id)}-${p.label}`,
      name: PART_NAMES[p.label] ?? p.label,
      sessionCmId: only.session_cm_id,
      sessionType: only.session_type,
      enrolled: p.enrolled,
      waitlisted: p.waitlisted,
      beds: p.beds,
      goal: null,
      goalPerSession: true,
      prior: p.prior,
      priorParts: p.prior_parts ?? null,
      parts: [{ ...p, label: '' }],
    }))
  }
  return rows.map((r) => ({
    key: `${String(r.session_cm_id)}-${r.session_name}`,
    name: r.session_name,
    sessionCmId: r.session_cm_id,
    sessionType: r.session_type,
    enrolled: r.enrolled,
    waitlisted: r.waitlisted,
    beds: r.beds,
    goal: r.goal,
    goalPerSession: false,
    prior: r.prior,
    priorParts: r.prior_parts ?? null,
    parts: r.parts,
  }))
}

const GROUP_OF: Record<string, 'At Camp' | 'Quests' | 'Teens'> = {
  main: 'At Camp',
  embedded: 'At Camp',
  ag: 'At Camp',
  quest: 'Quests',
  scit: 'Teens',
  tli: 'Teens',
}

/** The table's groups in session order; a group is named only when the scope spans more than one. */
export function fillGroups<T extends { session_type?: string; sessionType?: string }>(
  rows: readonly T[]
): Array<{ label: string | null; rows: T[] }> {
  const groups: Array<{ label: string; rows: T[] }> = []
  for (const r of rows) {
    const label = GROUP_OF[r.session_type ?? r.sessionType ?? ''] ?? 'At Camp'
    const last = groups.at(-1)
    if (last?.label === label) last.rows.push(r)
    else groups.push({ label, rows: [r] })
  }
  return groups.length > 1 ? groups : [{ label: null, rows: [...rows] }]
}

export interface FillTotal {
  readonly enrolled: number
  readonly waitlisted: number
  readonly beds: number | null
  /** Enrolled in the rows that have beds: the total's fill reads only those. */
  readonly bedsEnrolled: number
  readonly goal: number | null
  readonly goalEnrolled: number
  /** Last year in the matched rows only (ruling #15); null when no row matched. */
  readonly prior: number | null
  /** This year in the same matched rows, so the change compares like with like. */
  readonly matchedEnrolled: number
  /**
   * PR 8b: when anything folded in, the breakdown: the matched sessions ("N matched sessions", or the one
   * session's own name when the rows are its cabin groups), then each folded session, added up by name.
   */
  readonly priorParts: readonly ApiTodayPriorPart[] | null
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/** The total row. Its comparison adds only sessions with a match last year (ruling #15). */
export function fillTotal(rows: readonly FillRow[]): FillTotal {
  const withBeds = rows.filter((r) => r.beds != null)
  const withGoal = rows.filter((r) => r.goal != null)
  const matched = rows.filter((r) => r.prior != null)
  const prior = matched.length ? sum(matched.map((r) => r.prior ?? 0)) : null
  return {
    enrolled: sum(rows.map((r) => r.enrolled)),
    waitlisted: sum(rows.map((r) => r.waitlisted)),
    beds: withBeds.length ? sum(withBeds.map((r) => r.beds ?? 0)) : null,
    bedsEnrolled: sum(withBeds.map((r) => r.enrolled)),
    goal: withGoal.length ? sum(withGoal.map((r) => r.goal ?? 0)) : null,
    goalEnrolled: sum(withGoal.map((r) => r.enrolled)),
    prior,
    matchedEnrolled: sum(matched.map((r) => r.enrolled)),
    priorParts: totalBreakdown(matched, prior),
  }
}

/** The total's breakdown (PR 8b): the matched sessions' own figures, then each folded session by name. */
function totalBreakdown(
  matched: readonly FillRow[],
  prior: number | null
): ApiTodayPriorPart[] | null {
  const folded = new Map<string, number>()
  for (const r of matched)
    for (const p of (r.priorParts ?? []).slice(1))
      folded.set(p.name, (folded.get(p.name) ?? 0) + p.prior)
  if (prior == null || folded.size === 0) return null
  const cabinGroups = matched.every((r) => r.goalPerSession)
  const host = cabinGroups
    ? (matched.find((r) => r.priorParts)?.priorParts?.[0]?.name ?? '')
    : `${String(matched.length)} matched ${matched.length === 1 ? 'session' : 'sessions'}`
  const added = sum([...folded.values()])
  return [
    { name: host, prior: prior - added },
    ...[...folded].map(([name, n]) => ({ name, prior: n })),
  ]
}

/** A folded session's name in the tooltip (wording A): "Session 2b" reads "2b". */
export function foldName(name: string): string {
  return name.replace(/^Session /, '')
}

/** The tooltip's line (#50, wording A): the main session as named, then each folded one, shortened. */
export function foldedLine(parts: readonly ApiTodayPriorPart[]): Array<[string, number]> {
  return parts.map((p, i) => [i === 0 ? p.name : foldName(p.name), p.prior])
}

export interface PacePrior {
  /** Last year's curve over the sessions the fill total compares. */
  readonly curve: readonly ApiTodayPacePoint[]
  /** The fill total's prior figure: Pace's "{year}: N" reads exactly what the total compares with. */
  readonly now: number | null
  readonly parts: readonly ApiTodayPriorPart[] | null
}

/**
 * Pace's comparison (PR 8b): the same sessions the fill total compares (matched plus folded), not
 * Velocity's whole scope. Null when Session fill sent no curve, so Pace keeps Velocity's own prior.
 */
export function pacePrior(data: ApiTodaySessions, oneSession: boolean): PacePrior | null {
  if (!data.pace_prior) return null
  const total = fillTotal(scopeRows(data.rows, oneSession))
  return { curve: data.pace_prior, now: total.prior, parts: total.priorParts }
}

export interface OpenPlace {
  readonly words: string
  readonly full: boolean
}

/**
 * Open places on the bunk plan: a cabin group is "full" at its beds, and "n left" once it passes the
 * Availability page's limited threshold (percent). A group with no beds says nothing.
 */
export function openPlaces(row: FillRow, limitedThreshold: number): OpenPlace[] {
  const out: OpenPlace[] = []
  for (const p of row.parts) {
    if (!p.beds) continue
    const left = p.beds - p.enrolled
    const who = p.label ? `${PART_NAMES[p.label] === 'AG cabins' ? 'AG' : p.label} ` : ''
    if (left <= 0) out.push({ words: `${who}full`, full: true })
    else if ((p.enrolled / p.beds) * 100 >= limitedThreshold)
      out.push({ words: `${who}${String(left)} left`, full: false })
  }
  return out
}

export type TodayNoteKey = 'enrolled' | 'same' | 'dash' | 'sessions' | 'fill' | 'recent' | 'nextDay'

export interface TodayNote extends DefinitionNote {
  readonly key: TodayNoteKey
}

interface NoteInputs {
  readonly basis: PriorBasis
  readonly dayOffset: number | null | undefined
  readonly priorYear: number
  readonly throughNextDay: boolean
  /** Something on the page reads "—" for a figure last year can't be rebuilt for. */
  readonly dash: boolean
  readonly fill: FillBasis
  /** Recent sign-ups is showing (it folds away when empty). */
  readonly recent: boolean
}

/** The page's numbered notes (decision 11), in page order, only the ones that show; never on hover. */
export function todayNotes(i: NoteInputs): TodayNote[] {
  const py = String(i.priorYear)
  const fold = `A ${py} embedded session with no ${String(i.priorYear + 1)} match is added to the ${py} figure of the session whose dates contain it (dotted figures show the breakdown); with one session picked, the headline counts each camper in them once.`
  const same =
    i.basis === 'same_point'
      ? `Same point: the same day of ${String(i.priorYear)}'s registration, counted from priority day${
          i.dayOffset != null && i.dayOffset >= 0
            ? ` (today is day ${String(i.dayOffset + 1)})`
            : ''
        }. Enrolled then means registered by that day and not cancelled by it. Registration never closes: families come off waitlists until the day before a session starts, so every change on this page compares this way, all year, even after the season. Each session compares with its own match in ${String(i.priorYear)} (the same session, a renamed one, or the same name; teen programs by program), and the total adds only those, so a ${String(i.priorYear)} session not offered this year is not counted. ${fold}`
      : `No comparison: this season's or ${py}'s registration dates aren't set in Kindred, so there is no same registration day to read ${py} at. Today never compares with another day in its place.`
  const fill =
    i.fill === 'plan'
      ? 'Fill: Beds are the bunk plan, cabins planned times beds per cabin, as Overview\'s Capacity counts them, with all-gender cabins in their session. They answer "is there a bed?". Quests and teen programs have no cabins and use the places set in Manage. A group is "full" at its beds and shows the places left once Availability calls it limited.'
      : 'Fill: Goal is the participant goal set for each session in the budget config, the figure Forecast plans against. It answers "is registration on plan?". Goals are usually set in October; until then a session reads "goal not set yet".'
  const all: Array<[TodayNoteKey, string, boolean]> = [
    [
      'enrolled',
      'Enrolled: campers with a summer enrollment in this scope, each counted once however many sessions they hold. Applied and Incomplete are separate rows and are never added in.',
      true,
    ],
    ['same', same, true],
    [
      'dash',
      `A dash (—): a waitlist, Applied and Incomplete can't be rebuilt for a day in ${String(i.priorYear)}, so they have no comparison.`,
      i.dash,
    ],
    [
      'sessions',
      'Camper-sessions: Pace and Session fill count enrollments, so a camper in two sessions counts twice. That is why their totals run higher than Enrolled.',
      true,
    ],
    ['fill', fill, true],
    [
      'recent',
      'Recent sign-ups: enrollments whose Enrolled on day (the camp-time day the camper became enrolled) falls in the last 7 days, newest first. One line per camper per day: a camper who joined several sessions that day shows the first and "+N more". The six newest lines are listed; View all opens every one.',
      i.recent,
    ],
    ['nextDay', PRIORITY_DAY_NOTE, i.throughNextDay],
  ]
  return all.filter(([, , shown]) => shown).map(([key, text], idx) => ({ key, n: idx + 1, text }))
}

/** A path inside Analytics that keeps the viewed season (`?year=`) and nothing else from this page. */
export function analyticsHref(path: string, search: string): string {
  const year = new URLSearchParams(search).get('year')
  return year ? `${path}?year=${encodeURIComponent(year)}` : path
}

/** A note's number by key (the cards mark their figures with it). */
export function noteNumber(notes: readonly TodayNote[], key: TodayNoteKey): number | undefined {
  return notes.find((n) => n.key === key)?.n
}
