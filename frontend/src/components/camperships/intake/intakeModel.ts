/**
 * Requests › Form intake's model (spec 71 §2.4; the form-intake mock): the cells' words, the filters, the origin marks,
 * and Add a Request…'s pre-fill, problems, body and effects. Pure; the server decided every figure and flag.
 */
import type { PillTone } from '../kit/kitStyles'
import { aidHref, type AidView } from '../kit/asOf'
import { formatCampDateTime, formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { aidSessionName, aidTinyName } from '../kit/sessionShort'
import type { RequestOrigin } from '../kit/words'
import { whoWords } from '../household/historyWords'
import { programLabel } from '../requests/programLabel'
import type {
  AdditionCreateIn,
  AidOnNoRequestLineOut,
  BecameOut,
  BecameStatus,
  FormIntakeRowOut,
  GapSessionOut,
  IntakeSessionOut,
  RegistrationAskOut,
} from './intakeTypes'

// ── sessions ────────────────────────────────────────────────────────────────────────────────

export type SessionIndex = ReadonlyMap<number, IntakeSessionOut>

export function sessionIndex(sessions: readonly IntakeSessionOut[]): SessionIndex {
  return new Map(sessions.map((s) => [s.session_cm_id, s]))
}

/** A session the read does not name (it always does): plain words, never an id. */
const UNKNOWN = 'a session'
export const fullName = (id: number, names: SessionIndex): string => names.get(id)?.name ?? UNKNOWN
export function tinyName(id: number, names: SessionIndex): string {
  const s = names.get(id)
  return s === undefined ? UNKNOWN : aidTinyName(s.name, s.session_type)
}
export function shortName(id: number, names: SessionIndex): string {
  const s = names.get(id)
  return s === undefined ? UNKNOWN : aidSessionName(s.name, s.session_type)
}

// ── filters (owner Q3-A: the server computes needs_look) ───────────────────────────────────────

export type IntakeSegment = 'look' | 'reg' | 'all'
export const SEGMENTS: ReadonlyArray<{
  readonly value: IntakeSegment
  readonly label: string
  readonly title: string
}> = [
  {
    value: 'look',
    label: 'Needs a look',
    title:
      'Needs a look: CampMinder aid on no request, an enrollment no request holds, a session that is unclear, or a request made from a registration ask that no one has reviewed yet.',
  },
  {
    value: 'reg',
    label: 'Registration ask only',
    title:
      'Families who asked for aid when registering and never filed the aid form: a follow-up list',
  },
  {
    value: 'all',
    label: 'All forms',
    title:
      'Every camper on an aid form or a registration ask this season, plus enrolled campers in applicant households',
  },
]

/** `?show=`: Needs a look is its absence. */
export function readSegment(raw: string | null): IntakeSegment {
  return raw === 'reg' || raw === 'all' ? raw : 'look'
}

export function inSegment(row: FormIntakeRowOut, segment: IntakeSegment): boolean {
  if (segment === 'look') return row.needs_look === true
  if (segment === 'reg') return row.registration_only
  return true
}

/** CampMinder's camp aid on this row that no request holds (D170's money: shown, never counted). */
export function amberAid(row: FormIntakeRowOut): number {
  return (
    (row.campminder_aid ?? [])
      .filter((a) => !a.on_request)
      .reduce((sum, a) => sum + Math.round(a.amount * 100), 0) / 100
  )
}

/** The chip from Season's line (`?cmaid=1`): only the rows that line counts. */
export const inChip = (row: FormIntakeRowOut, cmaidOnly: boolean): boolean =>
  !cmaidOnly || amberAid(row) > 0

export function segmentCounts(
  rows: readonly FormIntakeRowOut[],
  cmaidOnly: boolean
): Record<IntakeSegment, number> {
  const chipped = rows.filter((r) => inChip(r, cmaidOnly))
  return {
    look: chipped.filter((r) => inSegment(r, 'look')).length,
    reg: chipped.filter((r) => inSegment(r, 'reg')).length,
    all: chipped.length,
  }
}

// ── cells ─────────────────────────────────────────────────────────────────────────────────────

/** A string the server defaults to "": its words, or the fallback when it is blank. */
export const wordsOr = (words: string | undefined, fallback: string): string =>
  words !== undefined && words !== '' ? words : fallback

export const camperLabel = (row: {
  readonly camper_name?: string | undefined
  readonly household_label?: string | undefined
}): string => wordsOr(row.camper_name, wordsOr(row.household_label, ''))

/** A household's page, keeping the season (D15). */
export const householdHref = (view: AidView, householdCmId: number): string =>
  aidHref(`/aid/households/${String(householdCmId)}`, view)

const regDate = (ask: RegistrationAskOut): string => (ask.on ? ` (${formatShortDate(ask.on)})` : '')

/** An answer's program in words: by the family of the session it names (Teen Programs, Quests, as the Requests grid
 * names them), else by its program (At Camp for an answer that names no session). */
export function answerProgram(
  a: { readonly program_key: string; readonly named_session_cm_id?: number | null | undefined },
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): string {
  const family = names.get(a.named_session_cm_id ?? 0)?.program_family ?? ''
  return programLabel(programs, family !== '' && family !== 'other' ? family : a.program_key)
}

/** Form asked, in two parts: what the form (or registration form) asked, and a registration ask beside a filed form. */
export function askedParts(
  row: FormIntakeRowOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): { main: string; reg: string | null; muted: boolean } {
  const reg = row.registration_ask ?? null
  if (row.registration_only && reg !== null)
    return {
      main: `Registration ask only · ${formatMoney(reg.amount)}${regDate(reg)}`,
      reg: null,
      muted: false,
    }
  const answers = row.answers ?? []
  if (answers.length === 0)
    return {
      main: row.filed ? 'not on the form' : 'no aid form, no registration ask',
      reg: reg === null ? null : `reg. ask ${formatMoney(reg.amount)}`,
      muted: true,
    }
  const main = answers
    .map((a) => {
      const named = a.named_session_cm_id ?? 0
      const what = named > 0 ? shortName(named, names) : a.option_text
      return `${answerProgram(a, names, programs)}: ${what} · ${formatMoney(a.ask)}`
    })
    .join('; ')
  return { main, reg: reg === null ? null : `reg. ask ${formatMoney(reg.amount)}`, muted: false }
}

export function askedWords(
  row: FormIntakeRowOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): string {
  const { main, reg } = askedParts(row, names, programs)
  return reg === null ? main : `${main} · ${reg}`
}

/** The cell's title: whole sentences. */
export function askedTitle(
  row: FormIntakeRowOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): string {
  const reg = row.registration_ask ?? null
  if (row.registration_only && reg !== null)
    return `No aid form. The registration form's "financial assistance" ask: ${formatMoney(reg.amount)}${reg.on ? `, answered ${formatShortDate(reg.on)}` : ''}.`
  const answers = row.answers ?? []
  if (answers.length === 0)
    return row.filed
      ? 'The household filed the aid form, but it names no program for this camper'
      : 'No aid form and no registration ask. CampMinder shows the camper enrolled.'
  const asked = answers
    .map((a) => {
      const named = a.named_session_cm_id ?? 0
      const what = named > 0 ? fullName(named, names) : a.option_text
      return `${answerProgram(a, names, programs)}: ${what} · ${formatMoney(a.ask)}`
    })
    .join('; ')
  return reg === null
    ? asked
    : `${asked}; and a registration ask of ${formatMoney(reg.amount)}${regDate(reg)}`
}

export function enrolledWords(
  row: FormIntakeRowOut,
  names: SessionIndex
): { text: string; title: string } {
  const ids = row.enrolled_session_cm_ids ?? []
  if (ids.length === 0) return { text: 'none', title: 'Enrolled in nothing this season (status 2)' }
  return {
    text: ids.map((id) => tinyName(id, names)).join(' · '),
    title: ids.map((id) => fullName(id, names)).join(' · '),
  }
}

const STATUS: Readonly<Record<BecameStatus, { words: string; tone: PillTone }>> = {
  active: { words: 'Active', tone: 'ok' },
  session_unclear: { words: 'Session unclear', tone: 'amber' },
  duplicate_pending: { words: 'Duplicate pending', tone: 'red' },
  duplicate: { words: 'Duplicate', tone: 'stone' },
  withdrawn: { words: 'Withdrawn', tone: 'stone' },
  cancelled: { words: 'Cancelled', tone: 'stone' },
}
export const becameStatus = (status: BecameStatus) => STATUS[status]

/** A request's session in the Became cell: tiny, or its candidates while unclear. */
export function becameSession(b: BecameOut, names: SessionIndex): string {
  const candidates = b.candidate_session_cm_ids ?? []
  if (b.session_cm_id === 0 && candidates.length > 0)
    return candidates.map((id) => tinyName(id, names)).join(' or ')
  // No candidates: the camper is enrolled in nothing the answer could be; the aside says so ("not enrolled").
  return b.session_cm_id === 0 ? '' : tinyName(b.session_cm_id, names)
}

/** The muted words after a withdrawn request's session ("no longer enrolled"). */
export function becameAside(b: BecameOut): string | null {
  if (b.why === 'not_enrolled')
    return b.status === 'session_unclear' && b.session_cm_id === 0
      ? 'not enrolled'
      : 'no longer enrolled'
  if (b.why === 'answer_edited') return 'answer changed'
  if (b.why === 'removed') return 'removed'
  return null
}

/** The pill's title: the whole sentence. */
export function becameTitle(b: BecameOut, names: SessionIndex): string {
  const candidates = b.candidate_session_cm_ids ?? []
  if (b.status === 'session_unclear' && candidates.length === 0)
    return 'Session unclear: the camper is enrolled in no session the answer could be (status 2). It settles once they enroll.'
  if (b.status === 'session_unclear')
    return `Session unclear: enrolled in ${candidates.map((id) => fullName(id, names)).join(' and ')}, and the answer could be either. Settle Session… on the household.`
  const full = b.session_cm_id === 0 ? 'session unclear' : fullName(b.session_cm_id, names)
  if (b.why === 'not_enrolled')
    return `Withdrawn: no longer enrolled in ${full}. Its decisions are kept.`
  if (b.why === 'answer_edited')
    return `Withdrawn: the family changed the form's answer from ${full}. Its decisions are kept.`
  if (b.why === 'removed') return 'Withdrawn: removed by staff. Its decisions are kept.'
  if (b.status === 'duplicate_pending')
    return `Duplicate pending: another request asks for ${full} too. Keep one on the household.`
  return `${STATUS[b.status].words} · ${full}`
}

/** Why a row has no request (or none for a session it is enrolled in): short for the cell, whole for its title. */
export function whyWords(
  row: FormIntakeRowOut,
  names: SessionIndex
): { short: string; long: string } | null {
  const reg = row.registration_ask ?? null
  const gap = row.gap_sessions ?? []
  switch (row.why_not) {
    case 'registration_only': {
      const amount = formatMoney(reg?.amount ?? 0)
      return {
        short: `No aid form: asked ${amount} when registering`,
        long: `No aid form. They asked ${amount} for financial assistance when registering${reg ? regDate(reg) : ''} and never filed the aid form, so the dashboard made no request.`,
      }
    }
    case 'adult_not_registered': {
      const named = (row.answers ?? []).find((a) => (a.named_session_cm_id ?? 0) > 0)
      const what = named ? shortName(named.named_session_cm_id ?? 0, names) : 'it'
      return {
        short: `No request: no adult is registered for ${what}`,
        long: `No request. The form asks for ${named ? fullName(named.named_session_cm_id ?? 0, names) : 'an adult program'}, but no adult in the household is registered for it yet. It will be made once one registers.`,
      }
    }
    case 'no_household':
      return {
        short: 'No request: no household in CampMinder',
        long: 'No request. CampMinder links this camper to no household, so the dashboard has nowhere to put a request. Fix the household in CampMinder; the next form sync makes it.',
      }
    case 'enrolled_no_request': {
      const tiny = gap.map((g) => tinyName(g.session_cm_id, names)).join(', ')
      const full = gap.map((g) => fullName(g.session_cm_id, names)).join(', ')
      if (!row.filed && reg === null)
        return {
          short: 'No request: no form, but aid was posted',
          long: `No request. The household filed no aid form and no registration ask, but CampMinder posted ${formatMoney(amberAid(row))} of camp aid. Add a Request… makes the request and a blank application.`,
        }
      return reg !== null
        ? {
            short: `None for ${tiny}: asked ${formatMoney(reg.amount)} at registration`,
            long: `No request for ${full}. The aid form names another program; they asked ${formatMoney(reg.amount)} when registering${regDate(reg)}.`,
          }
        : {
            short: `None for ${tiny}: the form doesn't name it`,
            long: `No request for ${full}. The camper is enrolled, but the household's aid form names no program for it.`,
          }
    }
    case 'not_enrolled':
      return {
        short: 'No request: not enrolled in what the form asked',
        long: 'No request. The form asks for a session the camper is not enrolled in (status 2).',
      }
    case 'answer_edited':
      return {
        short: 'The form answer changed',
        long: "The family changed the form's answer; the request it made is withdrawn, its decisions kept.",
      }
    default:
      return null
  }
}

export function footerWords(rows: readonly FormIntakeRowOut[]): string {
  const families = new Set(
    rows.map((r) => (r.household_cm_id > 0 ? `h${String(r.household_cm_id)}` : r.key))
  ).size
  return `${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} · ${String(families)} ${families === 1 ? 'family' : 'families'}`
}

// ── origin marks (design-language rule 9; owner Q2-A) ─────────────────────────────────────────

/** What an origin mark reads: Form intake's Became and the household page's `addition` share these fields. */
export interface OriginFacts {
  readonly origin: BecameOut['origin']
  readonly reviewed?: boolean | null | undefined
  readonly added_by?: string | undefined
  readonly added_at?: string | undefined
  readonly added_reason?: string | undefined
  readonly reviewed_by?: string | undefined
  readonly reviewed_at?: string | undefined
}

export function originOf(b: OriginFacts): RequestOrigin | null {
  if (b.origin === 'added') return 'added'
  if (b.origin === 'registration_ask') return b.reviewed === true ? 'reg_ask' : 'reg_ask_review'
  return null
}

/** Who and when, in the page's words: the household page names staff from their email and reads the day at camp. */
export interface OriginWords {
  readonly who: (actor: string) => string
  readonly day: (iso: string) => string
}
const PLAIN_WORDS: OriginWords = { who: (actor) => actor, day: formatShortDate }

/** "Mar 3": a stored time's day at camp (a UTC stamp read at camp); a bare day (YYYY-MM-DD) as it is written. */
export function campDayOf(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso.trim())
    ? formatShortDate(iso)
    : formatCampDateTime(iso).split(' ').slice(0, 2).join(' ')
}

const NO_NAMES: ReadonlyMap<string, string> = new Map()
/** Form intake's words for who and when: staff named from their email (no history to name them by), the day at camp. */
export const INTAKE_WORDS: OriginWords = {
  who: (actor) => whoWords(actor, NO_NAMES),
  day: campDayOf,
}

/** "Added by Pat Garcia, Mar 3: “…”", the mark's title and the household card's line. */
export function addedByWords(b: OriginFacts, words: OriginWords = PLAIN_WORDS): string {
  const by = wordsOr(b.added_by, '')
  return `Added by ${by === '' ? 'staff' : words.who(by)}${b.added_at ? `, ${words.day(b.added_at)}` : ''}: “${b.added_reason ?? ''}”`
}

export function originTitle(b: OriginFacts, words: OriginWords = PLAIN_WORDS): string {
  if (b.origin === 'added') return addedByWords(b, words)
  const made =
    "From a registration ask: the dashboard made this request from the registration form's aid ask, dated within a day of the enrollment."
  if (b.reviewed === true) {
    const by = wordsOr(b.reviewed_by, '')
    return `${made} Reviewed by ${by === '' ? 'staff' : words.who(by)}${b.reviewed_at ? `, ${words.day(b.reviewed_at)}` : ''}.`
  }
  return `${made.replace('From a registration ask:', 'From a registration ask, not yet reviewed:')} Mark Reviewed if it is right; Cancel Request… on the household if it is not.`
}

/** A rule-made request no one has reviewed: the row's Mark Reviewed (casework). */
export const unreviewed = (row: FormIntakeRowOut): BecameOut | undefined =>
  (row.became ?? []).find(
    (b) =>
      b.origin === 'registration_ask' &&
      b.reviewed !== true &&
      (b.addition_id ?? '') !== '' &&
      b.status !== 'withdrawn' &&
      b.status !== 'cancelled'
  )

// ── Remove… (the household card) ───────────────────────────────────────────────────────────────

/** Retiring an addition with a posted round is refused (PR 1's guard): say so before the save. */
export function removeBlock(b: {
  readonly posted_rounds?: readonly number[] | undefined
}): string | null {
  const posted = b.posted_rounds ?? []
  if (posted.length === 0) return null
  return `Round ${String(Math.max(...posted))} is posted: undo Posted first`
}

// ── Add a Request… ─────────────────────────────────────────────────────────────────────────────

const LIVE: ReadonlySet<BecameStatus> = new Set(['active', 'session_unclear', 'duplicate_pending'])

/** What Add a Request… works on: a Form intake row, a Season line, or a camper found with Find a Camper Not Listed…. */
export interface AddTarget {
  readonly key: string
  readonly household_cm_id: number
  readonly person_cm_id: number
  readonly camper_name: string
  readonly household_label: string
  readonly gap: readonly GapSessionOut[]
  /** Sessions a live request holds: shown switched off under "Already held" (design rule 3). */
  readonly held: ReadonlyArray<{ readonly session_cm_id: number; readonly status: BecameStatus }>
  readonly registration_ask: RegistrationAskOut | null
  /** No aid form at all: Add makes a blank application too. */
  readonly noForm: boolean
  /** CampMinder's money on no request, by session: the Round 1 Add a Request… offers to record (Q5-A). */
  readonly campminder: ReadonlyMap<number, number>
  /** The day CampMinder posted that money, by session (the checkbox's "(Mar 9)"). */
  readonly campminderOn: ReadonlyMap<number, string>
  readonly startSession: number | null
  readonly startAsk: number | null
}

function cmMap(gap: readonly GapSessionOut[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const g of gap)
    if (g.campminder_amount !== null && g.campminder_amount !== undefined)
      out.set(g.session_cm_id, g.campminder_amount)
  return out
}

function heldOf(row: FormIntakeRowOut): AddTarget['held'] {
  const out: Array<{ session_cm_id: number; status: BecameStatus }> = []
  for (const b of row.became ?? []) {
    if (!LIVE.has(b.status)) continue
    const ids = b.session_cm_id > 0 ? [b.session_cm_id] : (b.candidate_session_cm_ids ?? [])
    for (const id of ids)
      if (!out.some((h) => h.session_cm_id === id))
        out.push({ session_cm_id: id, status: b.status })
  }
  return out
}

export function targetFromRow(row: FormIntakeRowOut): AddTarget {
  const gap = row.gap_sessions ?? []
  const campminder = cmMap(gap)
  const start = gap.find((g) => campminder.has(g.session_cm_id)) ?? gap[0]
  const reg = row.registration_ask ?? null
  const startSession = start?.session_cm_id ?? null
  return {
    key: row.key,
    household_cm_id: row.household_cm_id,
    person_cm_id: row.person_cm_id,
    camper_name: row.camper_name ?? '',
    household_label: row.household_label ?? '',
    gap,
    held: heldOf(row),
    registration_ask: reg,
    noForm: row.registration_only || !row.filed,
    campminder,
    campminderOn: new Map(
      (row.campminder_aid ?? [])
        .filter((a) => !a.on_request && a.posted_on)
        .map((a) => [a.session_cm_id, a.posted_on ?? ''] as const)
    ),
    startSession,
    startAsk:
      reg?.amount ?? (startSession === null ? null : (campminder.get(startSession) ?? null)),
  }
}

/**
 * A Season line (owner Q4-A): the session the posting suggests, and the registration ask when the Form intake row has
 * one (the approved mock), else the line's own pre-fill, CampMinder's posted amount.
 */
export function targetFromLine(
  line: AidOnNoRequestLineOut,
  row: FormIntakeRowOut | undefined
): AddTarget {
  const gap = line.gap_sessions ?? []
  const base = row === undefined ? null : targetFromRow(row)
  const suggested = line.prefill.session_cm_id
  const startSession =
    suggested > 0 && gap.some((g) => g.session_cm_id === suggested)
      ? suggested
      : (gap[0]?.session_cm_id ?? null)
  return {
    key: line.row_key,
    household_cm_id: line.household_cm_id,
    person_cm_id: line.person_cm_id,
    camper_name: line.camper_name ?? '',
    household_label: line.household_label ?? '',
    gap,
    held: base?.held ?? [],
    registration_ask: base?.registration_ask ?? null,
    noForm: base?.noForm ?? false,
    campminder: cmMap(gap),
    campminderOn: line.posted_on
      ? new Map([...(base?.campminderOn ?? []), [line.session_cm_id, line.posted_on]])
      : (base?.campminderOn ?? new Map()),
    startSession,
    startAsk: base?.registration_ask?.amount ?? line.prefill.ask,
  }
}

export interface AddDraft {
  readonly session: number | null
  readonly ask: string
  readonly reason: string
  /** Q5-A: ticked by default. */
  readonly recordRound1: boolean
}

export function startDraft(target: AddTarget): AddDraft {
  return {
    session: target.startSession,
    ask: target.startAsk === null ? '' : String(target.startAsk),
    reason: '',
    recordRound1: true,
  }
}

const AMOUNT = /^\d+(\.\d{1,2})?$/
const bare = (ask: string) =>
  ask
    .trim()
    .replace(/^\$\s*/, '')
    .replaceAll(',', '')

/** The typed ask as a number; null when it is not an amount. */
export function parseAsk(ask: string): number | null {
  const raw = bare(ask)
  return AMOUNT.test(raw) ? Number(raw) : null
}

/** Why Add Request would be refused, one problem at a time (the kit's amber line, once a save is tried). */
export function addProblem(draft: AddDraft): string | null {
  if (draft.session === null) return 'Pick a session'
  const raw = bare(draft.ask)
  if (raw === '') return 'Enter the Ask'
  if (!AMOUNT.test(raw)) return 'Not an amount'
  if (Number(raw) <= 0) return 'The ask must be above $0'
  if (draft.reason.trim() === '') return 'Reason is required'
  return null
}

/** The Round 1 the save records: CampMinder's amount, when the box is ticked on a session CampMinder paid. */
export function round1Of(target: AddTarget, draft: AddDraft): number | null {
  if (draft.session === null || !draft.recordRound1) return null
  return target.campminder.get(draft.session) ?? null
}

export function addBody(target: AddTarget, draft: AddDraft): AdditionCreateIn {
  return {
    household_cm_id: target.household_cm_id,
    person_cm_id: target.person_cm_id,
    session_cm_id: draft.session ?? 0,
    ask: parseAsk(draft.ask) ?? 0,
    reason: draft.reason.trim(),
    round1_campminder: round1Of(target, draft),
  }
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

export interface IntakeOption {
  readonly value: string
  readonly label: string
  readonly group: string
  readonly title: string
  readonly disabled?: boolean
}

/** The Session picker: the gap sessions, then the held ones switched off under "Already held". */
export function sessionOptions(target: AddTarget, names: SessionIndex): IntakeOption[] {
  const group =
    target.person_cm_id === 0 ? 'Family Camp weekends, no request' : 'Enrolled, no request'
  const gaps = target.gap.map((g): IntakeOption => ({
    value: String(g.session_cm_id),
    label: `${shortName(g.session_cm_id, names)}${target.campminder.has(g.session_cm_id) ? ' · CampMinder aid here' : ''}`,
    group,
    title: fullName(g.session_cm_id, names),
  }))
  const held = target.held.map((h): IntakeOption => {
    const words = STATUS[h.status].words
    return {
      value: `held:${String(h.session_cm_id)}`,
      label: `${shortName(h.session_cm_id, names)} · holds a request`,
      group: 'Already held',
      disabled: true,
      title: `${fullName(h.session_cm_id, names)} holds ${article(words)} ${words} request`,
    }
  })
  return [...gaps, ...held]
}

/** Where the Ask's pre-fill came from, beside the box. */
export function askSource(target: AddTarget, draft: AddDraft): string {
  const reg = target.registration_ask
  if (reg !== null) return `registration ask${reg.on ? `, ${formatShortDate(reg.on)}` : ''}`
  const cm = draft.session === null ? undefined : target.campminder.get(draft.session)
  return cm === undefined ? 'no ask on file: type it' : `CampMinder posted ${formatMoney(cm)} here`
}

export interface AddEffect {
  readonly sym: 'ok' | 'hand' | 'info'
  readonly lead: string
  readonly rest: string
  readonly then?: string
}

/** What Add Request does to the money (Q5-A's number meaning), one effect per line. */
export function addEffects(
  target: AddTarget,
  draft: AddDraft,
  names: SessionIndex,
  poolWords: string | null
): AddEffect[] {
  const session = draft.session
  const tiny = session === null ? '…' : tinyName(session, names)
  const amount = parseAsk(draft.ask)
  const cm = session === null ? undefined : target.campminder.get(session)
  const r1 = round1Of(target, draft)
  const where = poolWords ?? 'Committed and Posted'
  const then =
    r1 !== null
      ? `→ Round 1 ${formatMoney(r1)}, posted: the money counts in ${where}`
      : cm !== undefined
        ? `→ Needs an offer, Round 1; CampMinder's ${formatMoney(cm)} counts once Round 1 is decided`
        : '→ Needs an offer, Round 1'
  const effects: AddEffect[] = [
    {
      sym: 'ok',
      lead: `Makes ${article(tiny)} ${tiny} ${target.person_cm_id === 0 ? 'household ' : ''}request`,
      rest: amount !== null && amount > 0 ? `, asking ${formatMoney(amount)}` : '',
      then,
    },
  ]
  if (target.noForm)
    effects.push({
      sym: 'hand',
      lead: '',
      rest: 'No aid form: a blank application is made',
      then: '→ type income later with Income correction… on the household',
    })
  effects.push({
    sym: 'info',
    lead: '',
    rest: 'Logged with your name and reason; Remove… on the household undoes it',
  })
  return effects
}

/** The toolbar status after a save. */
export function addedStatus(
  target: AddTarget,
  session: number,
  ask: number,
  round1: number | null,
  names: SessionIndex,
  poolWords: string | null
): string {
  const tiny = tinyName(session, names)
  const label = camperLabel(target)
  const cm = target.campminder.get(session)
  if (round1 !== null)
    return `✓ ${label} · ${tiny} added · ${formatMoney(round1)} now counts as Posted in ${poolWords ?? 'the budget'}`
  if (cm !== undefined)
    return `✓ ${label} · ${tiny} added · ${formatMoney(cm)} counts once Round 1 is decided`
  return `✓ Added ${article(target.person_cm_id === 0 ? 'household' : tiny)} ${target.person_cm_id === 0 ? 'household ' : ''}${tiny} request for ${label} · ask ${formatMoney(ask)}`
}
