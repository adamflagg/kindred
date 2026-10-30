/**
 * The adult aid form on Form intake (adult aid form design §5, §7, §10; approved mock v2, every knob at its ★): the
 * words of the response rows, the opened row's three panels, Link…, Ignore…, Pull Now's status slot and the refused
 * read's warn row. Pure; the server decided every match, figure and note.
 */
import type { PillTone } from '../kit/kitStyles'
import { formatCampDateTime } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { aidCellShortName } from '../kit/sessionShort'
import { programLabel } from '../requests/programLabel'
import type {
  BecameOut,
  FormCandidateOut,
  FormChangeOut,
  FormIntakeRowOut,
  FormResponseOut,
  GoogleFormStatusOut,
  IgnoreKind,
  LinkCandidatesOut,
  MatchSignal,
  SupersededOut,
} from './intakeTypes'
import {
  amberAid,
  campDayOf,
  fullName,
  inChip,
  inSegment,
  INTAKE_WORDS,
  readSegment,
  wordsOr,
  tinyName,
  type IntakeSegment,
  type SessionIndex,
} from './intakeModel'

/** A run of words, bold or plain: the panels' and editors' lines, drawn by the component. */
export interface Seg {
  readonly text: string
  readonly bold?: boolean
}

const who = (actor: string | undefined) => INTAKE_WORDS.who(actor ?? '')
const day = (iso: string | undefined) => (iso ? campDayOf(iso) : '')
/** "14:20": a stored time's clock on camp time. */
const clock = (iso: string) => formatCampDateTime(iso).split(' ')[2] ?? ''
/** "Nov 12, 14:20". */
const dayClock = (iso: string) => {
  const [month, d, time] = formatCampDateTime(iso).split(' ')
  return `${month ?? ''} ${d ?? ''}, ${time ?? ''}`
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`
}
const NUMBER_WORDS = ['no one', 'one', 'two', 'three', 'four', 'five', 'six']
const countWords = (n: number) => NUMBER_WORDS[n] ?? String(n)
const SIGNAL_ORDER: readonly MatchSignal[] = ['name', 'birthdate', 'email']
const signalWords = (signals: readonly MatchSignal[]) =>
  andList(SIGNAL_ORDER.filter((s) => signals.includes(s)))

/** A session in the one-line short form a reader names a weekend by: "Family Camp 4", "Family Camp 4 Adults". */
function weekendShort(id: number, names: SessionIndex): string {
  const s = names.get(id)
  return s === undefined ? 'a session' : aidCellShortName(s.name, s.session_type)
}
const firstSession = (c: FormCandidateOut | undefined) => c?.session_cm_ids?.[0] ?? 0
/** The read leaves empty lists and words out of the JSON: these read them back as empty. */
const candidatesOf = (r: FormResponseOut): readonly FormCandidateOut[] => r.candidates ?? []
const signalsOf = (c: FormCandidateOut | undefined): readonly MatchSignal[] =>
  (c?.signals ?? []).filter((s): s is MatchSignal => SIGNAL_ORDER.includes(s as MatchSignal))
const weekendOf = (r: FormResponseOut) => r.weekend_session_cm_id ?? 0
const typedName = (r: FormResponseOut) => r.name_typed ?? ''

// ── the opened row's figures (K2 a: each note beside its figure) ───────────────────────────────

export interface FigureRow {
  readonly label: string
  /** The figure in money, or null when it was not read (shown "unknown", never $0). */
  readonly value: string | null
  readonly note: string
}

const PRICED: ReadonlyArray<{ field: string; label: (year: number) => string }> = [
  { field: 'ask', label: () => 'Ask' },
  { field: 'total_gross_income', label: (y) => `${String(y - 1)} gross income` },
  { field: 'expected_gross_income', label: (y) => `${String(y)} expected income` },
  { field: 'non_retirement_savings', label: () => 'Savings and investments' },
  { field: 'total_medical_expenses', label: () => 'Medical out of pocket' },
]

/** The priced figures' fields, in the panel's order. */
export const PRICED_FIELDS: readonly string[] = PRICED.map((p) => p.field)

const figureOf = (r: FormResponseOut, field: string) =>
  (r.figures ?? []).find((f) => f.field === field)

/**
 * The priced figures. `flagged` is a second response that came after a decision (GF-4, owner Q6): where it says
 * otherwise, the note beside the figure says what, and that it was not applied (mock v2 step 4).
 */
export function figureRows(
  r: FormResponseOut,
  year: number,
  flagged: FormResponseOut | null = null
): FigureRow[] {
  return PRICED.map(({ field, label }) => {
    const f = figureOf(r, field)
    const value = f === undefined || f.value === null ? null : formatMoney(f.value)
    const later = flagged === null ? undefined : figureOf(flagged, field)
    const differs =
      later !== undefined && later.value !== null && later.value !== (f?.value ?? null)
    // Only the parse note and the flagged one: the read sends no words for what the rules make of a figure.
    const notes = [
      f?.note ?? '',
      differs && flagged !== null
        ? `the ${day(flagged.submitted_at)} response says ${formatMoney(later.value ?? 0)}: flagged, not applied`
        : '',
    ].filter((n) => n !== '')
    return { label: label(year), value, note: notes.join(' · ') }
  })
}

/** A note split on its quoted typed words, which the panel draws in plain ink. */
export function noteParts(note: string): Array<{ text: string; quoted: boolean }> {
  const out: Array<{ text: string; quoted: boolean }> = []
  const re = /“[^”]*”|'[^']*'/g
  let at = 0
  for (const m of note.matchAll(re)) {
    const i = m.index
    if (i > at) out.push({ text: note.slice(at, i), quoted: false })
    out.push({ text: m[0], quoted: true })
    at = i + m[0].length
  }
  if (at < note.length) out.push({ text: note.slice(at), quoted: false })
  return out
}

/** The answers that price nothing, on one muted line: "Also: mortgage none · rent $2,200 · …". */
export function alsoLine(r: FormResponseOut): string {
  const money = (field: string, label: string, blankIsNone: boolean) => {
    const f = figureOf(r, field)
    if (f === undefined || f.value === null) return `${label} unknown`
    if (f.note) return `${label} ${f.typed ?? formatMoney(f.value)}, ${f.note}`
    return blankIsNone && f.value === 0 ? `${label} none` : `${label} ${formatMoney(f.value)}`
  }
  const kids = r.num_children ?? null
  const dependents =
    kids === null
      ? 'dependents unknown'
      : `${String(kids)} ${kids === 1 ? 'dependent' : 'dependents'}`
  const unemployment = r.unemployment === true ? 'yes' : r.unemployment === false ? 'no' : 'unknown'
  return `Also: ${[
    money('total_housing_expenses', 'mortgage', true),
    money('total_rent', 'rent', true),
    money('student_debt', 'student loans', false),
    dependents,
    `unemployment ${unemployment}`,
  ].join(' · ')}`
}

export const signedLine = (r: FormResponseOut) =>
  `Signed “${r.signature_typed ?? ''}”, ${day(wordsOr(r.agreement_date, r.submitted_at ?? ''))}`

// ── the Match panel ───────────────────────────────────────────────────────────────────────────

const REGISTERED: Readonly<Record<string, string>> = {
  enrolled: 'enrolled',
  applied: 'applied',
  waitlisted: 'waitlisted',
  incomplete: 'incomplete',
}

/** A candidate whose email matched someone else in their household: a tie-break, never a match (design §5). */
export function candidateNote(c: FormCandidateOut): string {
  return c.household_email === true
    ? "the typed email is someone else's in their household (a tie-break, never a match)"
    : ''
}

export function matchEvidence(
  r: FormResponseOut,
  names: SessionIndex
): { segs: Seg[]; muted: string } {
  const candidates = candidatesOf(r)
  const [first] = candidates
  switch (r.match_status) {
    case 'suggested': {
      if (candidates.length > 1) {
        const common = SIGNAL_ORDER.filter((s) => candidates.every((c) => signalsOf(c).includes(s)))
        const tie = candidates.find((c) => c.household_email === true)
        return {
          segs: [
            { text: 'Suggested: ' },
            { text: `${countWords(candidates.length)} people`, bold: true },
            { text: ` registered for ${weekendShort(weekendOf(r), names)} match on ` },
            { text: signalWords(common), bold: true },
            { text: common.length === 1 ? ' only' : '' },
          ],
          muted:
            tie === undefined
              ? ''
              : `· the email belongs to someone in ${wordsOr(tie.camper_name, 'one')}'s household (a tie-break, never a match)`,
        }
      }
      const note = first === undefined ? '' : candidateNote(first)
      return {
        segs: [
          { text: 'Suggested: ' },
          { text: wordsOr(first?.camper_name, 'one person'), bold: true },
          { text: ` (${tinyName(firstSession(first), names)}) matches on ` },
          { text: signalWords(signalsOf(first)), bold: true },
        ],
        muted: note ? `· ${note}` : '',
      }
    }
    case 'registered_elsewhere':
      return {
        segs: [
          { text: 'Chose ' },
          { text: weekendShort(weekendOf(r), names), bold: true },
          { text: ', registered for ' },
          { text: weekendShort(firstSession(first), names), bold: true },
        ],
        muted: `· ${wordsOr(first?.camper_name, 'someone')} matches on ${signalWords(signalsOf(first))}, in another weekend`,
      }
    case 'not_registered':
    case 'unmatched':
      return {
        segs: [{ text: `No ${String(registrationYear(r))} registration found`, bold: true }],
        muted: '· checked every hour',
      }
    case 'ignored':
      return {
        segs: [{ text: 'Ignored', bold: true }],
        muted: `· no match was tried after ${who(r.ignored_by)} ignored it. Link… shows who it matches`,
      }
    case 'staff':
      return {
        segs: [
          { text: `Linked by ${who(r.linked_by)}${r.linked_at ? `, ${day(r.linked_at)}` : ''}` },
        ],
        muted: registeredWords(first, names),
      }
    default: {
      const signals = signalsOf(first)
      return {
        segs: [
          { text: 'Matched on ' },
          { text: signalWords(signals), bold: true },
          ...(signals.includes('name') ? [] : [{ text: `; the name was typed “${typedName(r)}”` }]),
        ],
        muted: registeredWords(first, names),
      }
    }
  }
}

/** The season a response is for: its submit year, or the next one when it came in autumn for next summer. */
export function registrationYear(r: FormResponseOut): number {
  const at = r.submitted_at ?? ''
  const y = Number(at.slice(0, 4))
  const m = Number(at.slice(5, 7))
  return Number.isFinite(y) && m >= 9 ? y + 1 : y
}

function registeredWords(c: FormCandidateOut | undefined, names: SessionIndex): string {
  const id = firstSession(c)
  if (c === undefined || id === 0) return ''
  return `· ${REGISTERED[c.registration_status ?? 'enrolled'] ?? 'registered'}, ${fullName(id, names)}`
}

// ── the Responses panel ────────────────────────────────────────────────────────────────────────

const otherFigures = (o: SupersededOut, year: number) =>
  [
    o.ask != null ? `ask ${formatMoney(o.ask)}` : '',
    o.total_gross_income != null
      ? `${String(year - 1)} gross ${formatMoney(o.total_gross_income)}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')

/**
 * The Responses panel. `change` is the form change on the request this response prices (its Became's form_change,
 * GF-4): a second response after a decision is flagged there, not applied, and a deletion says when it was seen. The
 * read sends neither the second response's figures nor a deletion time of its own, so neither is shown.
 */
export function responseLines(
  r: FormResponseOut,
  change: FormChangeOut | null = null,
  flagged: FormResponseOut | null = null
): Array<{ text: string; current: boolean }> {
  const year = registrationYear(r)
  const open = change !== null && change.reviewed !== true ? change : null
  const isFlagged = open?.kind === 'changed_after_decision'
  const deletedOn = change?.kind === 'deleted' && change.at ? ` ${day(change.at)}` : ''
  const deleted = r.form_status === 'deleted' ? ` · deleted in Google${deletedOn}, kept here` : ''
  const lines = [
    {
      text: `This response, ${day(r.submitted_at)}${isFlagged ? ' · prices the request' : ''}${deleted}`,
      current: true,
    },
  ]
  if (isFlagged) {
    const at = wordsOr(flagged?.submitted_at, open.at ?? '')
    const figs =
      flagged === null
        ? ''
        : otherFigures(
            {
              response_id: flagged.response_id,
              submitted_at: flagged.submitted_at ?? '',
              ask: flagged.ask ?? null,
              total_gross_income: figureOf(flagged, 'total_gross_income')?.value ?? null,
            },
            year
          )
    lines.push({
      text: `Second response${at ? `, ${day(at)}` : ''}, after a decision${figs ? ` (${figs})` : ''}: flagged, not applied`,
      current: false,
    })
  }
  for (const o of r.superseded ?? []) {
    const figs = otherFigures(o, year)
    lines.push({
      text: `Earlier response, ${day(o.submitted_at)}, replaced ${day(o.replaced_at ?? r.submitted_at)}, before any decision${figs ? ` (${figs})` : ''}`,
      current: false,
    })
  }
  return lines
}

// ── a response no person holds: its Camper and Became cells, and its second line ─────────────

export function responseCamper(r: FormResponseOut) {
  return {
    name: `“${typedName(r)}”`,
    title: `Typed on the form: “${typedName(r)}”`,
    chip: 'not linked',
    chipTitle: `No person yet: Link… picks one from the ${String(registrationYear(r))} registrations`,
  }
}

const IGNORE_WORDS: Readonly<Record<IgnoreKind, (year: number) => string>> = {
  test: () => 'test or junk',
  duplicate: () => 'a duplicate',
  not_asking: (y) => `not asking for ${String(y)} aid`,
  other: () => 'other',
}

export function ignoredWords(r: FormResponseOut) {
  const kind = r.ignored_kind
  return {
    who: who(r.ignored_by),
    day: day(r.ignored_at),
    kind: kind === undefined || kind === '' ? '' : IGNORE_WORDS[kind](registrationYear(r)),
    reason: r.ignored_reason ?? '',
  }
}

export function responseBecame(
  r: FormResponseOut,
  names: SessionIndex
): { tone: PillTone; words: string; why: string; title: string } {
  const candidates = candidatesOf(r)
  const [first] = candidates
  const year = String(registrationYear(r))
  switch (r.match_status) {
    case 'suggested': {
      const people = candidates.map((c) => wordsOr(c.camper_name, 'someone')).join(' or ')
      if (candidates.length > 1) {
        const common = SIGNAL_ORDER.filter((s) => candidates.every((c) => signalsOf(c).includes(s)))
        return {
          tone: 'amber',
          words: 'Suggested',
          why: `${people} · ${signalWords(common)}${common.length === 1 ? ' only' : ''}`,
          title: `Suggested: ${countWords(candidates.length)} people registered for ${weekendShort(weekendOf(r), names)} match on ${signalWords(common)}${common.length === 1 ? ' only' : ''}. Link… shows them with their evidence.`,
        }
      }
      return {
        tone: 'amber',
        words: 'Suggested',
        why: `${people} · ${signalWords(signalsOf(first))}`,
        title: `Suggested: one person registered for ${weekendShort(weekendOf(r), names)} matches on ${signalWords(signalsOf(first))}. Link… shows the evidence.`,
      }
    }
    case 'registered_elsewhere':
      return {
        tone: 'amber',
        words: 'Registered elsewhere',
        why: `Chose ${tinyName(weekendOf(r), names)}, registered for ${tinyName(firstSession(first), names)}`,
        title: `Registered elsewhere: ${wordsOr(first?.camper_name, 'someone')} matches on ${signalWords(signalsOf(first))}, but is registered for ${fullName(firstSession(first), names)}, not the ${fullName(weekendOf(r), names)} the form chose. No request until staff link the response or the choice matches.`,
      }
    case 'ignored': {
      const w = ignoredWords(r)
      return {
        tone: 'stone',
        words: 'Ignored',
        why: `${w.who}, ${w.day}: “${w.reason}”`,
        title: `Ignored by ${w.who}, ${w.day}: “${w.reason}”. Never matched again. Link… undoes it.`,
      }
    }
    default:
      return {
        tone: 'sky',
        words: 'Not registered',
        why: `No ${year} registration found · checked hourly`,
        title: `Not registered: no one registered for any ${year} session matches. The dashboard checks again every hour and links it once they register.`,
      }
  }
}

export function responseNoRequestLine(r: FormResponseOut): string {
  if (r.match_status === 'ignored') {
    const w = ignoredWords(r)
    return `Ignored by ${w.who}, ${w.day} · ${w.kind === '' ? '' : `${w.kind}: `}“${w.reason}” · never matched again`
  }
  return `No request until the response is linked · typed “${typedName(r)}”`
}

/** Form asked for a response no person holds: the weekend chosen the short way (callout 2: no program prefix). */
export function responseAsked(
  r: FormResponseOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): { main: string; title: string } {
  const s = names.get(weekendOf(r))
  const what =
    s === undefined
      ? wordsOr(r.program_choice, 'a weekend')
      : aidCellShortName(s.name, s.session_type)
  const ask = r.ask == null ? 'ask unknown' : formatMoney(r.ask)
  return {
    main: `${what} · ${ask}`,
    title: `${programLabel(programs, r.program_key ?? '')} “${r.program_choice ?? ''}” · ${ask} · the adult aid form (the Google form)`,
  }
}

// ── a linked row: the adult-form flags its Became cell adds ───────────────────────────────────

/** The amber words after a form-made request's session: a deleted response, a flagged change, no price yet. */
export function becameFlag(b: BecameOut): { words: string; title: string } | null {
  const change = b.form_change
  if (change != null && change.reviewed !== true)
    return change.kind === 'deleted'
      ? {
          // The read's "deleted" also covers a response staff ignored or linked to someone else (PR 2): neutral words.
          words: 'response no longer linked',
          title: `The adult aid form response this request was priced from is no longer linked to it${change.at ? ` since ${day(change.at)}` : ''}: deleted in Google, ignored, or linked to someone else. The request and its decisions are kept, and nothing changes until staff act. Mark Reviewed keeps it as it is.`,
        }
      : {
          words: 'flagged, not applied',
          title: `A second response on ${day(change.at)}, after a decision: flagged, not applied. Mark Reviewed keeps the request as it is.`,
        }
  if (b.price_missing === true)
    return {
      words: 'no price yet',
      title:
        'No price yet: the program has no rates or tuition entered for the season, so the request waits for them.',
    }
  return null
}

/** The request a deleted or changed-after-decision response flags: the row's Mark Reviewed (casework). */
export const formChangeToReview = (row: FormIntakeRowOut): BecameOut | undefined =>
  (row.became ?? []).find((b) => {
    const change = b.form_change
    return change != null && change.reviewed !== true
  })

// ── the K4 status slot and the refused read's warn row ────────────────────────────────────────

/** "it returned 0 of 12 responses", or the status words when the read did not say how many. */
function refusedCounts(g: GoogleFormStatusOut): string | null {
  return g.returned != null && g.expected != null
    ? `${String(g.returned)} of ${String(g.expected)} responses`
    : null
}
const refusedStatus = (g: GoogleFormStatusOut) =>
  (g.last_pull_status ?? 'refused').replace(/^refused:\s*/, '').split(' · ')[0] ?? ''

export function lastReadWords(
  g: GoogleFormStatusOut | null
): { text: string; title: string; tone: 'muted' | 'warn' } | null {
  if (!g?.last_pulled_at) return null
  if (g.refused === true) {
    const at = clock(g.last_pulled_at)
    const counts = refusedCounts(g)
    return {
      text: `⚠ Read refused ${at}`,
      title: `The ${at} read from Google was refused: ${counts === null ? refusedStatus(g) : `it returned ${counts}`}, so nothing was removed.`,
      tone: 'warn',
    }
  }
  return {
    text: `Last read from Google: ${clock(g.last_pulled_at)}`,
    title: `Adult aid form last read from Google ${dayClock(g.last_pulled_at)}. The dashboard reads it every hour.`,
    tone: 'muted',
  }
}

export function refusedBand(g: GoogleFormStatusOut | null): { lead: string; meta: string } | null {
  if (g?.refused !== true) return null
  const at = clock(g.last_pulled_at ?? '')
  const counts = refusedCounts(g)
  const lead =
    counts === null
      ? `⚠ The ${at} read was refused (${refusedStatus(g)}), so nothing was removed.`
      : `⚠ The ${at} read was refused: Google returned ${counts}, so nothing was removed.`
  return { lead, meta: 'The hourly read tries again; Pull Now tries now.' }
}

/** Pull Now only starts the read (202): the list refreshes when it lands. */
export const PULLED_WORDS =
  '✓ Reading the adult aid form from Google: the list refreshes when it lands'

// ── Ignore… ───────────────────────────────────────────────────────────────────────────────────

export const IGNORE_KINDS = (year: number): Array<{ value: IgnoreKind; label: string }> => [
  { value: 'test', label: 'A test or junk response' },
  { value: 'duplicate', label: 'A duplicate of another response' },
  { value: 'not_asking', label: `Not asking for ${String(year)} aid` },
  { value: 'other', label: 'Other' },
]

export interface IgnoreDraft {
  readonly kind: IgnoreKind | null
  readonly reason: string
}

export function ignoreProblem(d: IgnoreDraft): string | null {
  if (d.kind === null) return 'A reason is required'
  if (d.kind === 'other' && d.reason.trim() === '') return 'Say why in Reason'
  return null
}

export const ignoreBody = (d: IgnoreDraft) => ({ kind: d.kind ?? 'other', reason: d.reason.trim() })

export interface FormEffect {
  readonly sym: 'ok' | 'hand' | 'info'
  readonly lead: string
  readonly rest?: string
  readonly then?: string
}

export const ignoreEffects = (r: FormResponseOut): FormEffect[] => [
  {
    sym: 'ok',
    lead: 'Leaves Responses to link',
    then: '→ All forms shows it as Ignored, with your reason',
  },
  { sym: 'ok', lead: '', rest: `Never matched again, even if ${typedName(r)} registers later` },
  { sym: 'info', lead: '', rest: 'Logged with your name' },
]

// ── Link… ─────────────────────────────────────────────────────────────────────────────────────

/** What the response says, the respondent email only here (design §8). */
export const typedLine = (l: LinkCandidatesOut): Array<{ label: string; value: string }> => [
  { label: 'Typed: ', value: `“${l.name_typed ?? ''}”` },
  { label: ' · born ', value: l.birthdate_typed ?? '' },
  { label: ' · ', value: l.respondent_email ?? '' },
  { label: ' · chose ', value: l.program_choice ?? '' },
]

export function linkEffects(
  r: FormResponseOut,
  pick: FormCandidateOut | null,
  names: SessionIndex
): FormEffect[] {
  const logged: FormEffect = { sym: 'info', lead: '', rest: 'Logged with your name' }
  if (pick === null)
    return [
      {
        sym: 'hand',
        lead: '',
        rest: 'Nothing to link yet: leave it',
        then: `→ the hourly read links it once ${typedName(r)} registers`,
      },
      { sym: 'hand', lead: '', rest: 'A test or junk response: Ignore… instead' },
      logged,
    ]
  const session = firstSession(pick)
  const out: FormEffect[] = []
  if (r.match_status === 'ignored')
    out.push({
      sym: 'ok',
      lead: 'Undoes the ignore',
      then: `→ it leaves Ignored; the log keeps ${who(r.ignored_by)}'s ignore and your link`,
    })
  out.push({
    sym: 'ok',
    lead: `Links the response to ${wordsOr(pick.camper_name, 'them')}`,
    then: `→ makes the ${session === 0 ? 'adult aid form' : tinyName(session, names)} request${r.ask == null ? '' : `, asking ${formatMoney(r.ask)}`}, priced from this form's own figures`,
  })
  if (session !== 0 && weekendOf(r) !== 0 && !sameWeekend(session, weekendOf(r), names))
    out.push({
      sym: 'hand',
      lead: '',
      rest: `The request follows the registration, ${weekendShort(session, names)}, not the ${weekendShort(weekendOf(r), names)} the form chose`,
      then: '→ noted "session differs from the answer"',
    })
  out.push(
    {
      sym: 'ok',
      lead: '',
      rest: 'The hourly read never re-matches it',
      then: '→ a wrong link is fixed with Link… again',
    },
    logged
  )
  return out
}

/** An Adult Reg session counts as its weekend: same Family Camp number (owner 10-29, D6: by number, not date). */
function sameWeekend(a: number, b: number, names: SessionIndex): boolean {
  if (a === b) return true
  const num = (id: number) => /Family Camp (\d+)/.exec(names.get(id)?.name ?? '')?.[1] ?? null
  const na = num(a)
  return na !== null && na === num(b)
}

// ── the grid: Form intake rows and the responses no person holds ───────────────────────────────

export type GridSegment = IntakeSegment | 'link'

/** Form intake's four segments (mock v2 step 5): Responses to link second, each title the mock's. */
export const GRID_SEGMENTS: ReadonlyArray<{
  readonly value: GridSegment
  readonly label: string
  readonly title: string
}> = [
  {
    value: 'look',
    label: 'Needs a look',
    title:
      'Needs a look: CampMinder aid on no request, an enrollment no request holds, a session that is unclear, a request made from a registration ask that no one has reviewed, or an adult aid form response deleted in Google or no longer linked, or a second one sent after a decision (flagged, not applied).',
  },
  {
    value: 'link',
    label: 'Responses to link',
    title:
      'Responses to link: adult aid form responses the dashboard could not attach to one person on its own. Suggested (a weak match), Registered elsewhere (another weekend) and Not registered (no registration this season yet, checked every hour). Link… or Ignore… each.',
  },
  {
    value: 'reg',
    label: 'Registration ask only',
    title:
      "People who asked for aid when registering, with no aid form for that kind of program (At Camp, B*Mitzvah, Family Camp or Adult Weekends): a follow-up list. An adult aid form response counts as that adult's form.",
  },
  {
    value: 'all',
    label: 'All forms',
    title:
      'Every camper and adult on an aid form, an adult aid form or a registration ask this season, plus enrolled campers in applicant households. Ignored responses show here, with the reason.',
  },
]

/** `?show=`, Responses to link (`link`) included; its absence is the default segment. */
export function readGridSegment(raw: string | null, closed = false): GridSegment {
  return raw === 'link' ? 'link' : readSegment(raw, closed)
}

export type IntakeGridRow =
  | {
      readonly kind: 'row'
      readonly key: string
      readonly row: FormIntakeRowOut
      /** The response the row's request is priced from. */
      readonly response: FormResponseOut | null
      /** A second response after a decision, flagged and not applied (GF-4): the row's response replaced by it. */
      readonly flagged?: FormResponseOut | null | undefined
    }
  | { readonly kind: 'response'; readonly key: string; readonly response: FormResponseOut }

/** A response no person holds sorts by how near it is to a request (mock v2 step 15). */
const RESPONSE_ORDER: Readonly<Record<string, number>> = {
  suggested: 0,
  registered_elsewhere: 1,
  not_registered: 2,
  unmatched: 2,
}

/**
 * The grid (mock v2 step 15): the responses to link first (Suggested, Registered elsewhere, Not registered), then each
 * Form intake row with its adult aid form response, then the ignored responses. A superseded response shows only in
 * its successor's Responses panel; a response whose row is not in the read stays a row of its own, never dropped.
 */
export function gridRows(
  rows: readonly FormIntakeRowOut[],
  responses: readonly FormResponseOut[]
): IntakeGridRow[] {
  const current = responses.filter((r) => r.match_status !== 'superseded')
  const keys = new Set(rows.map((r) => r.key))
  const held = (r: FormResponseOut) => keys.has(r.row_key ?? '')
  const byRow = new Map(current.filter(held).map((r) => [r.row_key ?? '', r]))
  const loose = current
    .filter((r) => !held(r))
    .map((response): IntakeGridRow => ({
      kind: 'response',
      key: `response:${response.response_id}`,
      response,
    }))
  const rank = (r: IntakeGridRow) =>
    r.kind === 'response' ? (RESPONSE_ORDER[r.response.match_status] ?? 9) : 9
  const toLink = loose.filter((r) => rank(r) < 9).sort((a, b) => rank(a) - rank(b))
  return [
    ...toLink,
    ...rows.map((row): IntakeGridRow => {
      const live = byRow.get(row.key) ?? null
      // Decided on an earlier response, then sent again: the row opens onto the one that prices it, the newer beside.
      const priced =
        live !== null && formChangeToReview(row)?.form_change?.kind === 'changed_after_decision'
          ? responses
              .filter(
                (r) => r.match_status === 'superseded' && r.superseded_by === live.response_id
              )
              .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))[0]
          : undefined
      return priced === undefined
        ? { kind: 'row', key: row.key, row, response: live }
        : { kind: 'row', key: row.key, row, response: priced, flagged: live }
    }),
    ...loose.filter((r) => rank(r) === 9),
  ]
}

export function inGridSegment(r: IntakeGridRow, segment: GridSegment): boolean {
  if (r.kind === 'response')
    return segment === 'all' || (segment === 'link' && r.response.to_link === true)
  return segment === 'link' ? false : inSegment(r.row, segment)
}

/** Season's chip (`?cmaid=1`) narrows to rows with CampMinder aid on no request: no response row has any. */
export const inGridChip = (r: IntakeGridRow, cmaidOnly: boolean) =>
  r.kind === 'row' ? inChip(r.row, cmaidOnly) : !cmaidOnly

export function gridCounts(
  rows: readonly IntakeGridRow[],
  cmaidOnly: boolean
): Record<GridSegment, number> {
  const chipped = rows.filter((r) => inGridChip(r, cmaidOnly))
  const n = (s: GridSegment) => chipped.filter((r) => inGridSegment(r, s)).length
  return { look: n('look'), link: n('link'), reg: n('reg'), all: chipped.length }
}

/** CampMinder aid on no request, for the footer: a response row has none. */
export const gridAmberAid = (r: IntakeGridRow) => (r.kind === 'row' ? amberAid(r.row) : 0)

/** The footer: rows and families, a response no person holds counted as a family of its own. */
export function gridFooterWords(rows: readonly IntakeGridRow[]): string {
  const families = new Set(
    rows.map((r) =>
      r.kind === 'row' && r.row.household_cm_id > 0 ? `h${String(r.row.household_cm_id)}` : r.key
    )
  ).size
  return `${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} · ${String(families)} ${families === 1 ? 'family' : 'families'}`
}
