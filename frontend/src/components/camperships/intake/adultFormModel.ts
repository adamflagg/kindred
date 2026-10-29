/**
 * The adult aid form on Form intake (adult aid form design §5, §7, §10; approved mock v2, every knob at its ★): the
 * words of the response rows, the opened row's three panels, Link…, Ignore…, Pull Now's status slot and the refused
 * read's warn row. Pure; the server decided every match, figure and note.
 */
import type { PillTone } from '../kit/kitStyles'
import { formatCampDateTime } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { aidCellShortName } from '../kit/sessionShort'
import type {
  BecameFormView,
  FormResponseView,
  GoogleFormStatusView,
  IgnoreKind,
  LinkCandidatesView,
  MatchSignal,
  OtherResponseView,
  PullResultView,
  ResponseCandidateView,
} from './adultFormTypes'
import {
  amberAid,
  campDayOf,
  fullName,
  inChip,
  inSegment,
  INTAKE_WORDS,
  tinyName,
  type IntakeSegment,
  type SessionIndex,
} from './intakeModel'
import type { BecameOut, FormIntakeRowOut } from './intakeTypes'

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
const firstSession = (c: ResponseCandidateView | undefined) => c?.session_cm_ids?.[0] ?? 0

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

const figureOf = (r: FormResponseView, field: string) => r.figures.find((f) => f.field === field)

export function figureRows(r: FormResponseView, year: number): FigureRow[] {
  return PRICED.map(({ field, label }) => {
    const f = figureOf(r, field)
    const value = f === undefined || f.value === null ? null : formatMoney(f.value)
    const note = [f?.note ?? '', f?.rule_note ?? ''].filter((n) => n !== '').join(' · ')
    return { label: label(year), value, note }
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
export function alsoLine(r: FormResponseView): string {
  const money = (field: string, label: string, blankIsNone: boolean) => {
    const f = figureOf(r, field)
    if (f === undefined || f.value === null) return `${label} unknown`
    if (f.note) return `${label} ${f.typed ?? formatMoney(f.value)}, ${f.note}`
    return blankIsNone && f.value === 0 ? `${label} none` : `${label} ${formatMoney(f.value)}`
  }
  const kids = figureOf(r, 'num_children')?.value ?? null
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

export const signedLine = (r: FormResponseView) =>
  `Signed “${r.signature_typed}”, ${day(r.agreement_date || r.submitted_at)}`

// ── the Match panel ───────────────────────────────────────────────────────────────────────────

const REGISTERED: Readonly<Record<string, string>> = {
  enrolled: 'enrolled',
  applied: 'applied',
  waitlisted: 'waitlisted',
  incomplete: 'incomplete',
}

export function matchEvidence(
  r: FormResponseView,
  names: SessionIndex
): { segs: Seg[]; muted: string } {
  const [first] = r.candidates
  const checked = r.checked_at ? `, last at ${clock(r.checked_at)}` : ''
  switch (r.match_status) {
    case 'suggested': {
      if (r.candidates.length > 1) {
        const common = SIGNAL_ORDER.filter((s) => r.candidates.every((c) => c.signals.includes(s)))
        return {
          segs: [
            { text: 'Suggested: ' },
            { text: `${countWords(r.candidates.length)} people`, bold: true },
            { text: ` registered for ${weekendShort(r.weekend_session_cm_id, names)} match on ` },
            { text: signalWords(common), bold: true },
            { text: common.length === 1 ? ' only' : '' },
          ],
          muted: '',
        }
      }
      return {
        segs: [
          { text: 'Suggested: ' },
          { text: first?.camper_name ?? 'one person', bold: true },
          { text: ` (${tinyName(firstSession(first), names)}) matches on ` },
          { text: signalWords(first?.signals ?? []), bold: true },
        ],
        muted: first?.note ? `· ${first.note}` : '',
      }
    }
    case 'registered_elsewhere':
      return {
        segs: [
          { text: 'Chose ' },
          { text: weekendShort(r.weekend_session_cm_id, names), bold: true },
          { text: ', registered for ' },
          { text: weekendShort(firstSession(first), names), bold: true },
        ],
        muted: `· ${first?.camper_name ?? 'someone'} matches on ${signalWords(first?.signals ?? [])}, in another weekend`,
      }
    case 'not_registered':
    case 'unmatched':
      return {
        segs: [{ text: `No ${String(registrationYear(r))} registration found`, bold: true }],
        muted: `· checked every hour${checked}`,
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
      const signals = first?.signals ?? []
      return {
        segs: [
          { text: 'Matched on ' },
          { text: signalWords(signals), bold: true },
          ...(signals.includes('name') ? [] : [{ text: `; the name was typed “${r.name_typed}”` }]),
        ],
        muted: registeredWords(first, names),
      }
    }
  }
}

/** The season a response is for: its submit year, or the next one when it came in autumn for next summer. */
export function registrationYear(r: FormResponseView): number {
  const y = Number(r.submitted_at.slice(0, 4))
  const m = Number(r.submitted_at.slice(5, 7))
  return Number.isFinite(y) && m >= 9 ? y + 1 : y
}

function registeredWords(c: ResponseCandidateView | undefined, names: SessionIndex): string {
  const id = firstSession(c)
  if (c === undefined || id === 0) return ''
  return `· ${REGISTERED[c.registration_status ?? 'enrolled'] ?? 'registered'}, ${fullName(id, names)}`
}

// ── the Responses panel ────────────────────────────────────────────────────────────────────────

const otherFigures = (o: OtherResponseView, year: number) =>
  [
    o.ask != null ? `ask ${formatMoney(o.ask)}` : '',
    o.total_gross_income != null
      ? `${String(year - 1)} gross ${formatMoney(o.total_gross_income)}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')

export function responseLines(r: FormResponseView): Array<{ text: string; current: boolean }> {
  const year = registrationYear(r)
  const flagged = r.flagged ?? []
  const deleted =
    r.form_status === 'deleted'
      ? ` · deleted in Google${r.deleted_at ? ` ${day(r.deleted_at)}` : ''}, kept here`
      : ''
  const lines = [
    {
      text: `This response, ${day(r.submitted_at)}${flagged.length > 0 ? ' · prices the request' : ''}${deleted}`,
      current: true,
    },
  ]
  for (const o of flagged) {
    const figs = otherFigures(o, year)
    lines.push({
      text: `Second response, ${day(o.submitted_at)}, after a decision${figs ? ` (${figs})` : ''}: flagged, not applied`,
      current: false,
    })
  }
  for (const o of r.superseded) {
    const figs = otherFigures(o, year)
    lines.push({
      text: `Earlier response, ${day(o.submitted_at)}, replaced ${day(o.replaced_at ?? r.submitted_at)}, before any decision${figs ? ` (${figs})` : ''}`,
      current: false,
    })
  }
  return lines
}

// ── a response no person holds: its Camper and Became cells, and its second line ─────────────

export function responseCamper(r: FormResponseView) {
  return {
    name: `“${r.name_typed}”`,
    title: `Typed on the form: “${r.name_typed}”`,
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

export function ignoredWords(r: FormResponseView) {
  return {
    who: who(r.ignored_by),
    day: day(r.ignored_at),
    kind: r.ignored_kind === undefined ? '' : IGNORE_WORDS[r.ignored_kind](registrationYear(r)),
    reason: r.ignored_reason ?? '',
  }
}

export function responseBecame(
  r: FormResponseView,
  names: SessionIndex
): { tone: PillTone; words: string; why: string; title: string } {
  const [first] = r.candidates
  const year = String(registrationYear(r))
  switch (r.match_status) {
    case 'suggested': {
      const people = r.candidates.map((c) => c.camper_name ?? 'someone').join(' or ')
      if (r.candidates.length > 1) {
        const common = SIGNAL_ORDER.filter((s) => r.candidates.every((c) => c.signals.includes(s)))
        return {
          tone: 'amber',
          words: 'Suggested',
          why: `${people} · ${signalWords(common)}${common.length === 1 ? ' only' : ''}`,
          title: `Suggested: ${countWords(r.candidates.length)} people registered for ${weekendShort(r.weekend_session_cm_id, names)} match on ${signalWords(common)}${common.length === 1 ? ' only' : ''}. Link… shows them with their evidence.`,
        }
      }
      return {
        tone: 'amber',
        words: 'Suggested',
        why: `${people} · ${signalWords(first?.signals ?? [])}${first?.note ? `; ${first.note}` : ''}`,
        title: `Suggested: one person registered for ${weekendShort(r.weekend_session_cm_id, names)} matches on ${signalWords(first?.signals ?? [])}${first?.note ? `; ${first.note}` : ''}. Link… shows the evidence.`,
      }
    }
    case 'registered_elsewhere':
      return {
        tone: 'amber',
        words: 'Registered elsewhere',
        why: `Chose ${tinyName(r.weekend_session_cm_id, names)}, registered for ${tinyName(firstSession(first), names)}`,
        title: `Registered elsewhere: ${first?.camper_name ?? 'someone'} matches on ${signalWords(first?.signals ?? [])}, but is registered for ${fullName(firstSession(first), names)}, not the ${fullName(r.weekend_session_cm_id, names)} the form chose. No request until staff link the response or the choice matches.`,
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

export function responseNoRequestLine(r: FormResponseView): string {
  if (r.match_status === 'ignored') {
    const w = ignoredWords(r)
    return `Ignored by ${w.who}, ${w.day} · ${w.kind === '' ? '' : `${w.kind}: `}“${w.reason}” · never matched again`
  }
  return `No request until the response is linked · typed “${r.name_typed}”`
}

// ── a linked row: the adult-form flags its Became cell adds ───────────────────────────────────

/** The amber words after a form-made request's session: a deleted response, a flagged change, no price yet. */
export function becameFlag(b: BecameOut): { words: string; title: string } | null {
  const f = b as BecameFormView
  const change = f.form_change
  if (change != null && !change.reviewed)
    return change.kind === 'deleted'
      ? {
          words: 'response deleted in Google',
          title: `The adult aid form response was deleted in Google on ${day(change.at)}. The request and its decisions are kept, and nothing changes until staff act. Mark Reviewed keeps it as it is.`,
        }
      : {
          words: 'flagged, not applied',
          title: `A second response on ${day(change.at)}, after a decision: flagged, not applied. Mark Reviewed keeps the request as it is.`,
        }
  if (f.price_missing === true)
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
    const change = (b as BecameFormView).form_change
    return change != null && !change.reviewed
  })

// ── the K4 status slot and the refused read's warn row ────────────────────────────────────────

export function lastReadWords(
  g: GoogleFormStatusView | null
): { text: string; title: string; tone: 'muted' | 'warn' } | null {
  if (g === null) return null
  if (g.refused) {
    const at = clock(g.last_pulled_at)
    const counts =
      g.returned !== undefined && g.expected !== undefined
        ? `it returned ${String(g.returned)} of ${String(g.expected)} responses`
        : (g.last_pull_status ?? 'refused').replace(/^refused:\s*/, '')
    const good = g.last_good_at ? ` Last good read ${clock(g.last_good_at)}.` : ''
    return {
      text: `⚠ Read refused ${at}`,
      title: `The ${at} read from Google was refused: ${counts}, so nothing was removed.${good}`,
      tone: 'warn',
    }
  }
  return {
    text: `Last read from Google: ${clock(g.last_pulled_at)}`,
    title: `Adult aid form last read from Google ${dayClock(g.last_pulled_at)}. The dashboard reads it every hour.`,
    tone: 'muted',
  }
}

export function refusedBand(g: GoogleFormStatusView | null): { lead: string; meta: string } | null {
  if (!g?.refused) return null
  const at = clock(g.last_pulled_at)
  const lead =
    g.returned !== undefined && g.expected !== undefined
      ? `⚠ The ${at} read was refused: Google returned ${String(g.returned)} of ${String(g.expected)} responses, so nothing was removed.`
      : `⚠ The ${at} read was refused (${(g.last_pull_status ?? 'refused').replace(/^refused:\s*/, '')}), so nothing was removed.`
  const asOf = g.last_good_at ? `Every response here is as of ${clock(g.last_good_at)}. ` : ''
  return { lead, meta: `${asOf}The hourly read tries again; Pull Now tries now.` }
}

export function pulledWords(result: PullResultView): string {
  if (result.status === 'done' && result.responses !== undefined)
    return `✓ Read from Google: ${String(result.responses)} responses, ${String(result.new ?? 0)} new${result.at ? ` (${clock(result.at)})` : ''}`
  if (result.status === 'refused') return '⚠ Google refused the read: nothing was removed'
  return '✓ Reading the adult aid form from Google: the list refreshes when it lands'
}

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

export const ignoreEffects = (r: FormResponseView): FormEffect[] => [
  {
    sym: 'ok',
    lead: 'Leaves Responses to link',
    then: '→ All forms shows it as Ignored, with your reason',
  },
  { sym: 'ok', lead: '', rest: `Never matched again, even if ${r.name_typed} registers later` },
  { sym: 'info', lead: '', rest: 'Logged with your name' },
]

// ── Link… ─────────────────────────────────────────────────────────────────────────────────────

/** What the response says, the respondent email only here (design §8). */
export const typedLine = (l: LinkCandidatesView): Array<{ label: string; value: string }> => [
  { label: 'Typed: ', value: `“${l.name_typed}”` },
  { label: ' · born ', value: l.birthdate_typed },
  { label: ' · ', value: l.respondent_email },
  { label: ' · chose ', value: l.program_choice },
]

export function linkEffects(
  r: FormResponseView,
  pick: ResponseCandidateView | null,
  names: SessionIndex
): FormEffect[] {
  const logged: FormEffect = { sym: 'info', lead: '', rest: 'Logged with your name' }
  if (pick === null)
    return [
      {
        sym: 'hand',
        lead: '',
        rest: 'Nothing to link yet: leave it',
        then: `→ the hourly read links it once ${r.name_typed} registers`,
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
    lead: `Links the response to ${pick.camper_name ?? 'them'}`,
    then: `→ makes the ${session === 0 ? 'adult aid form' : tinyName(session, names)} request${r.ask === null ? '' : `, asking ${formatMoney(r.ask)}`}, priced from this form's own figures`,
  })
  if (
    session !== 0 &&
    r.weekend_session_cm_id !== 0 &&
    !sameWeekend(session, r.weekend_session_cm_id, names)
  )
    out.push({
      sym: 'hand',
      lead: '',
      rest: `The request follows the registration, ${weekendShort(session, names)}, not the ${weekendShort(r.weekend_session_cm_id, names)} the form chose`,
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

export type IntakeGridRow =
  | {
      readonly kind: 'row'
      readonly key: string
      readonly row: FormIntakeRowOut
      readonly response: FormResponseView | null
    }
  | { readonly kind: 'response'; readonly key: string; readonly response: FormResponseView }

/** Each Form intake row (with its live adult-form response), then a row per live response no person holds. */
export function gridRows(
  rows: readonly FormIntakeRowOut[],
  responses: readonly FormResponseView[]
): IntakeGridRow[] {
  const current = responses.filter((r) => r.match_status !== 'superseded')
  const byRow = new Map(current.filter((r) => r.row_key !== '').map((r) => [r.row_key, r]))
  return [
    ...rows.map((row): IntakeGridRow => ({
      kind: 'row',
      key: row.key,
      row,
      response: byRow.get(row.key) ?? null,
    })),
    ...current
      .filter((r) => r.row_key === '')
      .map((response): IntakeGridRow => ({
        kind: 'response',
        key: `response:${response.response_id}`,
        response,
      })),
  ]
}

export function inGridSegment(r: IntakeGridRow, segment: GridSegment): boolean {
  if (r.kind === 'response') return segment === 'all' || (segment === 'link' && r.response.to_link)
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
