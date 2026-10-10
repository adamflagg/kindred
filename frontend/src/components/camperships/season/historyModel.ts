/**
 * Season › History (spec §7.6; D49; history.html B), pure. The server groups, filters, pages and
 * gates the log (D21); this module reads the page's URL into the read's query (D15) and, below,
 * words what each operation and row recorded, never recomputing an amount.
 */
import type {
  ApiAidFieldChange,
  ApiAidHistoryKind,
  ApiAidHistoryOperation,
  ApiAidHistoryPage,
  ApiAidHistoryRow,
} from '../../../types/api-types'
import { OFFSET_WORDS } from '../grants/registerModel'
import { aidHref, type AidView } from '../kit/asOf'
import { formatCampDateTime, formatLongDate, parseIsoDay } from '../kit/dates'
import { CANCEL_REASON_OPTIONS } from '../kit/editor'
import type { PillTone } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { aidSessionName } from '../kit/sessionShort'
import { codeWords } from '../requests/attention'
import { changeWords, isRulesSection, type RulesNames, SECTION_TITLES } from './rules/rulesModel'

// ── Filters and paging (D15: the view lives in the URL) ───────────────────────

/** One page of the log (the router allows up to 200). */
export const PER_PAGE = 50

/** Each kind's switcher and pill words (D49's kinds; intake is a toggle, not a kind choice). */
export const KIND_LABELS = {
  rules: 'Rules',
  offers: 'Offers & stages',
  money: 'Money edits',
  holds: 'On hold',
  grants: 'Grants',
  intake: 'Intake',
} as const satisfies Record<ApiAidHistoryKind, string>

const CHIP_ORDER: readonly ApiAidHistoryKind[] = ['rules', 'offers', 'money', 'holds', 'grants']

/** The kind switcher's choices, in the spec's order; Rules only for `rules` (D49, D76). */
export function chipKinds(canSeeRules: boolean): ApiAidHistoryKind[] {
  return CHIP_ORDER.filter((kind) => canSeeRules || kind !== 'rules')
}

export interface HistoryFilters {
  readonly kind: ApiAidHistoryKind | null
  readonly actor: string | null
  readonly since: string | null
  readonly until: string | null
  readonly q: string
  readonly intake: boolean
  readonly page: number
}

export type HistoryFilterKey = 'kind' | 'actor' | 'since' | 'until' | 'q' | 'intake' | 'page'

const MAX_ACTOR = 320
const MAX_TEXT = 200
const MAX_PAGE = 10_000
/** The router's first season (`_Year`, ge=2017): no aid log is older. */
const FIRST_SEASON = 2017

/**
 * A day the date filters take: a real day in a season's year. A date box typed year-first passes
 * through 0002-…, 0020-…, 0202-…, each a real day; the floor keeps those from being written (I4).
 */
export function isSeasonDay(value: string | null): value is string {
  if (value === null) return false
  const day = parseIsoDay(value)
  return day !== null && day.year >= FIRST_SEASON
}

/**
 * The view's filters from its URL. Anything the reader may not ask for, or the router would refuse
 * (an unknown kind, Rules without `rules`, a malformed day, a page out of range), reads as unset, so
 * a pasted link never fails the read.
 */
export function parseHistoryFilters(params: URLSearchParams, canSeeRules: boolean): HistoryFilters {
  const kind = params.get('kind')
  const page = Number(params.get('page') ?? '1')
  const since = params.get('since')
  const until = params.get('until')
  const actor = (params.get('actor') ?? '').slice(0, MAX_ACTOR)
  return {
    kind: chipKinds(canSeeRules).find((k) => k === kind) ?? null,
    actor: actor === '' ? null : actor,
    since: isSeasonDay(since) ? since : null,
    until: isSeasonDay(until) ? until : null,
    q: (params.get('q') ?? '').trim().slice(0, MAX_TEXT),
    intake: params.get('intake') === '1',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  }
}

/** The read's query, in the router's names: only what is set. */
export function historyQuery(filters: HistoryFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.kind !== null) query['kind'] = filters.kind
  if (filters.actor !== null) query['actor'] = filters.actor
  if (filters.since !== null) query['since'] = filters.since
  if (filters.until !== null) query['until'] = filters.until
  if (filters.q !== '') query['q'] = filters.q
  if (filters.intake) query['include_intake'] = 'true'
  if (filters.page > 1) query['page'] = String(filters.page)
  query['per_page'] = String(PER_PAGE)
  return query
}

/** The URL after one filter changes. Any change but the page's own goes back to page 1. */
export function withFilter(
  previous: URLSearchParams,
  key: HistoryFilterKey,
  value: string | null
): URLSearchParams {
  const next = new URLSearchParams(previous)
  if (value === null || value === '') next.delete(key)
  else next.set(key, value)
  if (key !== 'page') next.delete('page')
  return next
}

const OPERATION_ID = /^[a-z0-9]{15}$/

/** The opened lines (`open=`, comma-separated operation ids): a fold, so it is view state (D15). */
export function parseOpen(raw: string | null): string[] {
  if (raw === null) return []
  return [...new Set(raw.split(',').filter((id) => OPERATION_ID.test(id)))]
}

/** `open=` after one line is clicked; null when none is left open. */
export function toggleOpen(open: readonly string[], id: string): string | null {
  const next = open.includes(id) ? open.filter((o) => o !== id) : [...open, id]
  return next.length === 0 ? null : next.join(',')
}

const operations = (n: number) => (n === 1 ? 'operation' : 'operations')

/** The last page there is (1 when nothing matches). */
export function lastPage(page: ApiAidHistoryPage): number {
  return Math.max(1, Math.ceil(page.total / page.per_page))
}

// ── Words (D49: each operation one readable line; amounts as recorded, never recomputed) ──

/** Each kind's pill, in the kit's tones (history.html B's colours). */
export const KIND_TONE = {
  rules: 'emerald',
  offers: 'sky',
  money: 'amber',
  holds: 'red',
  grants: 'purple',
  intake: 'muted',
} as const satisfies Record<ApiAidHistoryKind, PillTone>

/** Sentence case for a logged code: "leave_at_family_level" reads "Leave at family level". */
export function codeText(code: string): string {
  const plain = code.replaceAll(/[_-]+/g, ' ').trim()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

/**
 * ⚠ Decision 4 (number meaning, to confirm): the words for the server's own action codes, by
 * collection, read from the writers (decisions `EventKind`, holds `HoldEventKind`, cancellations,
 * payer shares, grants, rules, capacity). Over an amount the word is its basis: `post` is the lock;
 * `ask` the family's ask; `award` a Round 3 amount, a Decided figure that may await approval, so it
 * never reads "Award" or "Awarded" (D80). A code missing here reads as its own words (`codeText`).
 */
const ACTION_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  aid_decisions: {
    ask: 'Ask entered',
    award: 'Round 3 amount entered',
    approve: 'Round 3 approved',
    refuse: 'Round 3 refused',
    post: 'Posted',
    unpost: 'Posted undone',
    accept: 'Accepted',
    unaccept: 'Accepted undone',
  },
  aid_hold_events: {
    place: 'Placed',
    lift: 'Lifted',
    release: 'Released',
    unrelease: 'Release undone',
  },
  aid_cancellations: { cancel: 'Cancelled', reopen: 'Reopened' },
  aid_payer_shares: {
    set_payer_shares: 'Payer shares set',
    set_household_share: 'Household share set',
  },
  aid_grants: { withdraw: 'Withdrawn' },
  // `place_grant` is logged on the placement-override collection, not on `aid_grants` (I1).
  aid_attribution_overrides: {
    place_grant: 'Grant placed',
    place_line: 'Line placed',
    reclassify: 'Reclassified',
  },
  // ⚠1 interim (lead-built, the owner rules later): past-tense words, so "Correct" never reads as
  // "this figure is correct" over a corrected figure. A cleared cost reads "Cost cleared"
  // (`rowActionWords`).
  aid_application_corrections: { correct: 'Corrected', cost_override: 'Cost set' },
  aid_flag_dispositions: {
    placed: 'Placed',
    reopen: 'Reopened',
    reclassified: 'Reclassified',
    leave_at_family_level: 'Left at family level',
  },
  aid_grantors: { retire: 'Retired', unretire: 'Unretired' },
  aid_sources: { map_grantor: 'Grantor mapped' },
  aid_requests: {
    status: 'Status changed',
    resolve_session: 'Session resolved',
    mark_duplicate: 'Marked duplicate',
    set_headcount: 'Number of people set',
  },
  aid_grant_placements: { place: 'Placed', remove: 'Removed' },
  aid_rules: {
    create: 'New version',
    save: 'Saved',
    approve: 'Approved',
    lock: 'Locked',
    new_version: 'New version',
    start_from_last_year: 'Started from last year',
    discard: 'Draft discarded',
  },
  aid_session_capacity: { set_capacity: 'Capacity set' },
}

/** The generic record writes, past tense like "Placed" and "Corrected" (#18), never "Create". */
const GENERIC_ACTION_WORDS: Readonly<Record<string, string>> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
}

export function actionWords(entity: string, action: string): string {
  return ACTION_WORDS[entity]?.[action] ?? GENERIC_ACTION_WORDS[action] ?? codeText(action)
}

const SYSTEM_ACTORS: Readonly<Record<string, string>> = {
  'system:intake': 'Intake',
  'system:ledger': 'Ledger sync',
  'system:grant-placement': 'Grant placement',
}
const SYSTEM = 'system:'

/** Who: the sign-in the log records (as the Rules tab shows an approver); the system's runs by name. */
export function actorWords(actor: string): string {
  const named = SYSTEM_ACTORS[actor]
  if (named !== undefined) return named
  return actor.startsWith(SYSTEM) ? codeText(actor.slice(SYSTEM.length)) : actor
}

/** A record's name, singular and plural; an unknown collection reads as its own words. */
const RECORD_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  aid_rules: ['rules version', 'rules versions'],
  aid_session_capacity: ['session capacity', 'session capacities'],
  aid_decisions: ['decision', 'decisions'],
  aid_cancellations: ['cancellation', 'cancellations'],
  aid_requests: ['request', 'requests'],
  aid_hold_events: ['hold', 'holds'],
  aid_grants: ['grant', 'grants'],
  aid_grant_placements: ['grant placement', 'grant placements'],
  aid_grantors: ['grantor', 'grantors'],
  aid_payer_shares: ['payer share', 'payer shares'],
  aid_applications: ['application', 'applications'],
  aid_application_corrections: ['correction', 'corrections'],
  aid_attribution_overrides: ['placement', 'placements'],
  aid_household_links: ['household link', 'household links'],
  aid_sources: ['source', 'sources'],
  aid_reported_history: ['reported figure', 'reported figures'],
  aid_postings: ['posting', 'postings'],
  aid_flag_dispositions: ['flag', 'flags'],
}

export function recordWords(entity: string, n: number): string {
  const words = RECORD_WORDS[entity]
  if (words !== undefined) return n === 1 ? words[0] : words[1]
  return entity.replace(/^aid_/, '').replaceAll('_', ' ')
}

const RULES = 'aid_rules'
const PLACEMENTS = 'aid_grant_placements'
const sectionTitle = (section: string): string =>
  isRulesSection(section) ? SECTION_TITLES[section] : codeText(section)
const joined = (parts: readonly string[]) => parts.filter((part) => part !== '').join(' · ')

/** More sections than this read as a count ("4 sections"). */
const SECTIONS_NAMED = 3

export interface OperationWords {
  readonly when: string
  readonly who: string
  readonly what: string
  readonly reason: string | null
}

/**
 * An operation's line (D49; history.html B "What happened"): the screen's action words, then the
 * server's summary as sent (H1: "7 requests · 6 families · $9,840 locked", counted and summed from
 * the rows as recorded, never here). Where the server has no summary (no request or family in it:
 * a rules save, a capacity) each count reads "Saved · 1 rules version" as before. An operation that
 * touched the rules adds its version, sections and what was done to them; a round's first Posted
 * tick locks its rules sections in the same operation (plan review I1), so it reads "Posted · …
 * locked; Rules v3 · … · Locked", never the locks alone. A rules approval's summary is its recorded
 * effect (H3, #2980), so it follows the rules part. The reason follows as written (an approval's
 * note names the approving body, D39).
 */
export function operationWords(op: ApiAidHistoryOperation): OperationWords {
  const versioned = op.rules_versions.length > 0
  const counts = op.counts.filter((count) => !versioned || count.entity !== RULES)
  // An approval's summary is its effect, worded for the rules part it follows.
  const summary = op.effect === null ? op.summary : ''
  const parts =
    summary === '' || counts.length === 0
      ? counts.map(
          (count) =>
            `${actionWords(count.entity, count.action)} · ${String(count.rows)} ${recordWords(count.entity, count.rows)}`
        )
      : [
          joined([
            [...new Set(counts.map((count) => actionWords(count.entity, count.action)))].join(', '),
            summary,
          ]),
        ]
  if (versioned) {
    const sections =
      op.rules_sections.length > SECTIONS_NAMED
        ? `${String(op.rules_sections.length)} sections`
        : op.rules_sections.map(sectionTitle).join(', ')
    const actions = [
      ...new Set(
        op.counts
          .filter((count) => count.entity === RULES)
          .map((count) => actionWords(count.entity, count.action))
      ),
    ].join(', ')
    parts.push(
      joined([
        `Rules ${op.rules_versions.map((v) => `v${String(v)}`).join(', ')}`,
        sections,
        actions,
        op.effect === null ? '' : op.summary,
      ])
    )
  }
  return {
    when: formatCampDateTime(op.at),
    who: actorWords(op.actor),
    what: parts.join('; '),
    reason: op.reason === '' ? null : op.reason,
  }
}

const positiveInt = (
  record: Readonly<Record<string, unknown>> | null,
  key: string
): number | null => {
  const value = record?.[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * A rules row's lines, in the Rules tab's words (PR 3's `changeWords`), each led by its section: a
 * setting change, and a section's status move ("Draft → Approved"). Stamps (who, when, the note) are
 * the line's own words, so they are left out. A created version holds its whole document in the log,
 * so it lists its diff against the version it was copied from (H4, `against_parent`), never every
 * setting as "added"; with no such diff (a season's first version) it reads as one line.
 */
export function rulesLines(row: ApiAidHistoryRow): string[] {
  if (row.before === null) {
    const version = positiveInt(row.after, 'version')
    const name = version === null ? 'A new version' : `New version v${String(version)}`
    const against = row.against_parent
    if (against !== null) {
      const [rowYear] = row.entity_id.split(':')
      const from = `${against.year === Number(rowYear) ? '' : `${String(against.year)} `}v${String(against.version)}`
      const lines = changeLines(against.changes)
      return lines.length === 0
        ? [`${name}, from ${from}: no setting changed`]
        : [`${name}, from ${from}:`, ...lines]
    }
    const parent = positiveInt(row.after, 'parent_version')
    return [
      `${name}${parent === null ? '' : `, from v${String(parent)}`}: its settings open in Rules`,
    ]
  }
  return changeLines(row.changes)
}

/** Paths compared part by part, a number as a number: Tier 2 before Tier 10. */
function naturalOrder(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const order = (a[i] ?? '').localeCompare(b[i] ?? '', 'en', { numeric: true })
    if (order !== 0) return order
  }
  return a.length - b.length
}

/**
 * The server lists a diff's settings sorted as text (Tier 1, Tier 10, Tier 11, Tier 2). The setting
 * changes go back in number order, each into a setting's slot, so the status lines stay put (#18).
 */
function inNumberOrder(changes: readonly ApiAidFieldChange[]): ApiAidFieldChange[] {
  const isSetting = (change: ApiAidFieldChange) => change.path[0] === 'document'
  const settings = changes.filter(isSetting).sort((a, b) => naturalOrder(a.path, b.path))
  let next = 0
  return changes.map((change) => (isSetting(change) ? (settings[next++] ?? change) : change))
}

/**
 * The Rules read view's names with no document to take labels from: a log row holds a diff, not the
 * version's sections. A check, a severity or a session fallback still reads in words ("High
 * expenses", "Warning"); a pool, program or decision type reads as its key in words.
 */
function staticNames(section: string): RulesNames | undefined {
  if (!isRulesSection(section)) return undefined
  return { section, pools: {}, programs: {}, decisionTypes: {}, criteria: {} }
}

/** A rules diff's lines: a setting change in the section's words, and a section's status move. */
function changeLines(changes: readonly ApiAidFieldChange[]): string[] {
  const lines: string[] = []
  for (const change of inNumberOrder(changes)) {
    const [root, section, ...rest] = change.path
    if (section === undefined) continue
    if (root === 'document') {
      lines.push(
        rest.length === 0
          ? `${sectionTitle(section)}: ${change.kind}`
          : `${sectionTitle(section)} › ${changeWords({ ...change, path: rest }, staticNames(section))}`
      )
    } else if (root === 'section_status' && rest.length === 1 && rest[0] === 'state') {
      const from = typeof change.before === 'string' ? change.before : 'draft'
      const to = typeof change.after === 'string' ? change.after : 'draft'
      lines.push(`${sectionTitle(section)}: ${codeText(from)} → ${codeText(to)}`)
    }
  }
  return lines
}

/** ⚠ Decision 4: the only fields formatted as money or percent; every other figure reads as recorded. A decision's ask is logged as `amount` under the action `ask` (no `ask` field on decision rows); an intake request logs its own `ask`, a float. */
const MONEY_FIELDS: ReadonlySet<string> = new Set(['amount', 'ask'])
const PERCENT_FIELDS: ReadonlySet<string> = new Set(['share_pct'])
/**
 * Codes worded as the Requests grid words them (a hold's `code`: "Placeholder income"; a payer
 * share's `source`, a request's `status`: "Intake default", "Duplicate pending").
 */
const CODE_FIELDS: ReadonlySet<string> = new Set(['code', 'source', 'status'])
/**
 * ⚠ Decision 4: an application's income figures read as money (`total_gross_income`, a housing
 * expense, savings), and so do an income correction's previous value and value (#18).
 */
const MONEY_FIGURE = /income|expense|savings|rent|housing/
/** Fields whose name staff read as a word, not as the field's code. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  lock_source: 'Locked by',
  session_cm_id: 'Session',
  household_cm_id: 'Household',
  grantor_key: 'Grantor',
  implied_program_families: 'Programs',
  headcount_non_infant: 'Headcount, not infants',
}
/** A record id the row's own household or camper link already stands for (#18). */
const LINKED_IDS: ReadonlySet<string> = new Set(['request', 'grant'])
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
/**
 * Never listed: the record's bookkeeping (the line already says who and when), and `event`, which
 * repeats the row's action code (the head words it; listed raw it would print "award", I2).
 */
const UNLISTED: ReadonlySet<string> = new Set([
  'id',
  'year',
  'actor',
  'created',
  'updated',
  'revision',
  'collectionId',
  'collectionName',
  'event',
])

const isWordList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((w) => typeof w === 'string')

/** A scalar, or a list of words (a source's program families), reads in one line. */
const isScalar = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  ['string', 'number', 'boolean'].includes(typeof value) ||
  isWordList(value)

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/

/**
 * The number in a recorded value: the log stores a Decimal as its exact string ('1420', '40'), so
 * decimal text is parsed; a number passes; anything else (blank, "n/a", "NaN", "Infinity") is null
 * and prints as recorded.
 */
function decimalOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !DECIMAL_TEXT.test(value)) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** The cancel form's words for a cancellation's reason code; a code it doesn't know reads as recorded. */
const CANCEL_REASON_WORDS: ReadonlyMap<string, string> = new Map(
  CANCEL_REASON_OPTIONS.map((option) => [option.value, option.label])
)

/**
 * Staff never read the server's `lock_source` codes (owner ruling D162, "Mark Posted"); the words
 * agree with kit/receiptModel.ts. A code missing here reads as its own words (`codeText`).
 */
const LOCK_SOURCE_WORDS: ReadonlyMap<string, string> = new Map([
  ['tick', 'Posted check'],
  ['ledger', 'CampMinder match'],
  ['placement', 'Grant placement'],
  // The 2026 sheet load (D67: read-only and labelled), in the receipt's own words.
  ['reproduced', 'Reproduced from the sheet'],
  // The same load's Round 1 on a request the sheet has no row for (owner, 10-07: "CampMinder only").
  ['campminder_only', 'From CampMinder (no sheet row)'],
])

/** What a row's values are read with: the season's session names, and whether it corrects money. */
interface RowContext {
  readonly sessions: ReadonlyMap<number, string> | undefined
  /** An income correction: its previous value and value are money. */
  readonly correctsMoney: boolean
  /** A decision's `amount`, worded by what it is: "Locked amount" (Posted), "Round 1 ask" (an ask). */
  readonly amountLabel: string | null
}

function fieldValue(entity: string, field: string, value: unknown, context: RowContext): string {
  if (value === null || value === undefined || value === '') return '—'
  if (isWordList(value)) return value.length === 0 ? '—' : value.map(codeText).join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (CODE_FIELDS.has(field) && typeof value === 'string') return codeWords(value)
  if (field === 'session_cm_id') return context.sessions?.get(Number(value)) ?? String(value)
  if (field === 'household_cm_id') return `Household ${String(value)}`
  if ((field === 'grantor_key' || field === 'field') && typeof value === 'string') {
    return codeText(value)
  }
  if (field === 'lock_source' && typeof value === 'string') {
    return LOCK_SOURCE_WORDS.get(value) ?? codeText(value)
  }
  if (entity === 'aid_cancellations' && field === 'reason' && typeof value === 'string') {
    return CANCEL_REASON_WORDS.get(value) ?? value
  }
  const n = decimalOf(value)
  const money =
    MONEY_FIELDS.has(field) ||
    MONEY_FIGURE.test(field) ||
    (context.correctsMoney && (field === 'previous_value' || field === 'value'))
  if (money && n !== null) return formatMoney(n)
  if (PERCENT_FIELDS.has(field) && n !== null) return `${String(value)}%`
  if (typeof value === 'string' && ISO_DAY.test(value)) return formatLongDate(value)
  if (typeof value === 'string' && ISO_TIME.test(value)) return formatCampDateTime(value)
  return String(value)
}

/** A row's old and new parts (the panel strikes the old through); `lines` keeps the one-string form. */
export interface FieldView {
  readonly label: string
  readonly kind: 'added' | 'removed' | 'changed'
  readonly before: string | null
  readonly after: string | null
}

function fieldView(entity: string, change: ApiAidFieldChange, context: RowContext): FieldView {
  const field = change.path[0] ?? ''
  const show = (value: unknown) => fieldValue(entity, field, value, context)
  return {
    label:
      (field === 'amount' ? context.amountLabel : null) ?? FIELD_LABELS[field] ?? codeText(field),
    kind: change.kind,
    before: change.kind === 'added' ? null : show(change.before),
    after: change.kind === 'removed' ? null : show(change.after),
  }
}

function fieldLine(entity: string, change: ApiAidFieldChange, context: RowContext): string {
  const v = fieldView(entity, change, context)
  if (v.kind === 'added') return `${v.label}: ${v.after ?? '—'}`
  if (v.kind === 'removed') return `${v.label}: removed (was ${v.before ?? '—'})`
  return `${v.label}: ${v.before ?? '—'} → ${v.after ?? '—'}`
}

/**
 * What the head names the row's record by (#18): a decision by its round, a hold by its code, a
 * capacity by its session. Otherwise the record's word alone when the row links its household or
 * camper; the record id only when nothing else names it.
 */
function subjectOf(
  row: ApiAidHistoryRow,
  sessions: ReadonlyMap<number, string> | undefined
): string {
  const record = recordWords(row.entity, 1)
  const [, qualifier] = row.entity_id.split(':')
  if (row.entity === 'aid_decisions' && qualifier !== undefined && /^\d+$/.test(qualifier)) {
    return `Round ${qualifier} decision`
  }
  if (row.entity === 'aid_hold_events' && qualifier !== undefined && qualifier !== '') {
    return `hold: ${codeWords(qualifier)}`
  }
  const session =
    positiveInt(row.after, 'session_cm_id') ?? positiveInt(row.before, 'session_cm_id')
  if (session !== null)
    return `${record} · ${sessions?.get(session) ?? `Session ${String(session)}`}`
  // Never the record id (owner O4: ids only in the CSV).
  return record
}

/** The field an income correction corrected, if it is an income figure. */
function correctsMoney(row: ApiAidHistoryRow): boolean {
  const field = row.after?.['field'] ?? row.before?.['field']
  return typeof field === 'string' && MONEY_FIGURE.test(field)
}

/** The mock's words for a decision's `amount`: what the number is, by the row's action. */
function amountLabel(row: ApiAidHistoryRow): string | null {
  if (row.entity !== 'aid_decisions') return null
  if (row.action === 'post') return 'Locked amount'
  const round = row.after?.['round'] ?? row.before?.['round']
  return row.action === 'ask' && typeof round === 'number' ? `Round ${String(round)} ask` : null
}

/** The household the row itself recorded, if it did (a create, or an update of that field). */
function householdOf(row: ApiAidHistoryRow): number | null {
  return positiveInt(row.after, 'household_cm_id') ?? positiveInt(row.before, 'household_cm_id')
}

export interface RowView {
  /** "Posted · decision req…:1 · <reason>" */
  readonly head: string
  readonly lines: readonly string[]
  /** The same fields as old and new parts, for the panel's strike-through. */
  readonly fields: readonly FieldView[]
  /** Nested values the row recorded that are not listed. */
  readonly hidden: number
  readonly householdCmId: number | null
  /** The household's link words: the server's name (H2), or "Household N" as the grid says. */
  readonly householdName: string | null
  readonly camperName: string | null
}

/** The row's action in words; a cost override whose new value is empty is a cleared cost. */
function rowActionWords(row: ApiAidHistoryRow): string {
  if (row.entity === 'aid_application_corrections' && row.action === 'cost_override') {
    const cleared = row.after?.['value'] === ''
    if (cleared) return 'Cost cleared'
  }
  return actionWords(row.entity, row.action)
}

function rulesHead(row: ApiAidHistoryRow): string {
  const [, version, section] = row.entity_id.split(':')
  return joined([
    actionWords(row.entity, row.action),
    version === undefined ? '' : `v${version}`,
    section === undefined ? '' : sectionTitle(section),
    row.reason,
  ])
}

/**
 * One row of an opened line: its action, record and reason, then the fields it recorded. `sessions`
 * (the season's session names, when the screen has them) names a session; else its number shows.
 */
export function rowView(row: ApiAidHistoryRow, sessions?: ReadonlyMap<number, string>): RowView {
  if (row.entity === RULES) {
    return {
      head: rulesHead(row),
      lines: rulesLines(row),
      fields: [],
      hidden: 0,
      householdCmId: null,
      householdName: null,
      camperName: null,
    }
  }
  // Who the row is about: the server's subject (H2), else the household the row itself recorded.
  const householdCmId = row.household_cm_id ?? householdOf(row)
  const linked = householdCmId !== null || row.camper_name !== null
  // A field the row's link already shows: the linked household's id, the request or grant it is about.
  const shownByLink = (change: ApiAidFieldChange) => {
    const field = change.path[0] ?? ''
    if (!linked) return false
    if (LINKED_IDS.has(field)) return true
    return (
      field === 'household_cm_id' &&
      householdCmId !== null &&
      [change.before, change.after].every(
        (v) => v === null || v === undefined || v === householdCmId
      )
    )
  }
  const topLevel = row.changes.filter((change) => change.path.length === 1)
  const unlisted = topLevel.filter(
    (change) => UNLISTED.has(change.path[0] ?? '') || shownByLink(change)
  )
  const listed = topLevel.filter(
    (change) =>
      !UNLISTED.has(change.path[0] ?? '') &&
      !shownByLink(change) &&
      isScalar(change.before) &&
      isScalar(change.after)
  )
  const context: RowContext = {
    sessions,
    correctsMoney: correctsMoney(row),
    amountLabel: amountLabel(row),
  }
  return {
    head: joined([rowActionWords(row), subjectOf(row, sessions), row.reason]),
    lines: listed.map((change) => fieldLine(row.entity, change, context)),
    fields: listed.map((change) => fieldView(row.entity, change, context)),
    hidden: row.changes.length - listed.length - unlisted.length,
    householdCmId,
    householdName:
      householdCmId === null ? null : (row.household_name ?? `Household ${String(householdCmId)}`),
    camperName: row.camper_name,
  }
}

/** The row's session in the ruled short form (the full name goes in a title); null when the row names none. */
export function rowSession(
  row: ApiAidHistoryRow,
  sessions?: ReadonlyMap<number, string>
): string | null {
  const id =
    row.session_cm_id ??
    positiveInt(row.after, 'session_cm_id') ??
    positiveInt(row.before, 'session_cm_id')
  if (id === null || id === 0) return null
  return aidSessionName(sessions?.get(id) ?? `Session ${String(id)}`, undefined)
}

/** One line of the change list: a key, the old value (struck) and the new one (bold). */
export interface ChangeItem {
  readonly label: string
  readonly before: string | null
  readonly after: string
}

const CHANGE_LINE = /^([^:]+): (.+) → (.+)$/

/** A rules line "Program split: Draft → Approved" as its key and its old and new words; null for a free sentence. */
export function changeParts(line: string): { label: string; before: string; after: string } | null {
  const m = CHANGE_LINE.exec(line)
  return m === null ? null : { label: m[1] ?? '', before: m[2] ?? '', after: m[3] ?? '' }
}

/** A row's change list, field or rules line alike; the old value is null when there was none ("— →" is omitted). */
export function changeItems(view: RowView): ChangeItem[] {
  if (view.fields.length === 0) {
    return view.lines.map((line) => {
      const parts = changeParts(line)
      return parts ?? { label: '', before: null, after: line }
    })
  }
  return view.fields.map((f) => ({
    label: f.label,
    before: f.kind === 'added' || f.before === '—' ? null : f.before,
    after: f.kind === 'removed' ? 'removed' : (f.after ?? '—'),
  }))
}

/**
 * "Open v4 in Rules ›" (D49): the newest version the operation touched, at its first section (the server
 * lists them sorted by key, so an approval of two opens on the first of those, not the tab's default). The link keeps the page's
 * as-of (D15; PR 3's I6 fix on the Rules tab).
 */
export function rulesLink(
  op: ApiAidHistoryOperation,
  view: AidView
): { label: string; href: string } | null {
  const version = op.rules_versions.at(-1)
  if (version === undefined) return null
  const section = op.rules_sections[0]
  return {
    label: `Open v${String(version)} in Rules ›`,
    href: aidHref('/aid/season/rules', view, {
      version: String(version),
      ...(section === undefined ? {} : { section }),
    }),
  }
}

/** A household's page, on the season, keeping the page's as-of (as the jump box and the grid do). */
export function householdHref(householdCmId: number, view: AidView): string {
  return aidHref(`/aid/households/${String(householdCmId)}`, view)
}

// ── The box: endless scroll over numbered pages (spec §7.2 C) ────────────────

const range = (page: number, perPage: number, total: number) =>
  `${String((page - 1) * perPage + 1)}–${String(Math.min(page * perPage, total))}`

/** Every loaded page's operations, newest first, each once: pages are numbers, not a cursor, so a row logged
 * between two reads can push the previous page's last row onto the next one (Review Focus 4). */
export function flattenPages(pages: readonly ApiAidHistoryPage[]): ApiAidHistoryOperation[] {
  const seen = new Set<string>()
  const out: ApiAidHistoryOperation[] = []
  for (const page of pages) {
    for (const op of page.operations) {
      if (seen.has(op.operation_id)) continue
      seen.add(op.operation_id)
      out.push(op)
    }
  }
  return out
}

/** Where each page after the first starts in `flattenPages`'s list: its page-break row goes there. */
export function pageStarts(
  pages: readonly ApiAidHistoryPage[]
): Array<{ page: number; index: number }> {
  const seen = new Set<string>()
  const out: Array<{ page: number; index: number }> = []
  let index = 0
  pages.forEach((page, i) => {
    if (i > 0) out.push({ page: page.page, index })
    for (const op of page.operations) {
      if (seen.has(op.operation_id)) continue
      seen.add(op.operation_id)
      index += 1
    }
  })
  return out
}

export const pageBreakWords = (page: number, perPage: number, total: number): string =>
  `Page ${String(page)} · ${range(page, perPage, total)}`

/**
 * The last row while more is to come: "Scroll for 51–100", or "◌ Loading 51–100…" while it loads.
 * `pagesRead` counts pages, not rows shown: a row repeated across two pages is shown once (Review
 * Focus 4), so the shown count would name a page already read.
 */
export function scrollRowWords(
  pagesRead: number,
  total: number,
  perPage: number,
  loading: boolean
): string | null {
  if (pagesRead * perPage >= total) return null
  const next = pagesRead + 1
  return loading
    ? `◌ Loading ${range(next, perPage, total)}…`
    : `Scroll for ${range(next, perPage, total)}`
}

export function footerWords(
  total: number,
  shown: number,
  page: number,
  last: number
): { count: string; pageOf: string; onScreen: string } {
  return {
    count: `${String(total)} ${operations(total)}`,
    pageOf: `Page ${String(page)} of ${String(last)}`,
    onScreen:
      shown >= total ? '· all on screen' : `· 1–${String(shown)} on screen; scroll for more`,
  }
}

/** The page whose first row is at or above the box's scroll position (`tops` = each page's first row's offset). */
export function pageAtScroll(tops: readonly number[], scrollTop: number): number {
  let page = 1
  tops.forEach((top, i) => {
    if (scrollTop >= top) page = i + 1
  })
  return page
}

/** "All ‹n›": the total with no kind picked; with one picked, the kinds' counts summed (H5). */
export function allCount(
  page: ApiAidHistoryPage | undefined,
  kind: ApiAidHistoryKind | null
): number | null {
  if (page === undefined) return null
  return kind === null ? page.total : page.kind_counts.reduce((sum, c) => sum + c.operations, 0)
}

// ── The opened row's middle panel: compact tables and row blocks (spec §7.2 D, V#19) ──

export interface CompactRow {
  readonly key: string
  readonly camper: string
  readonly camperHref: string | null
  readonly household: string
  readonly householdHref: string | null
  readonly session: string
  /** The session's full name, for the cell's title (the cell itself reads the ruled short form). */
  readonly sessionFull: string
  /** A family-level row: no camper, so the cell says "household request" in muted words. */
  readonly householdRequest: boolean
  readonly round: string | null
  /** A placement's Round cell is muted when no round counts its grant ("after offer", "—"). */
  readonly roundMuted: boolean
  /** Why: the cell's title, one clause per distinct answer. Null when the row names no round. */
  readonly roundTitle: string | null
  readonly amount: number | null
}

type CountsIn = NonNullable<ApiAidHistoryRow['counts_in']>[number]

/** The Round column's head title on a placements table (season-history.html, owner 10-10 B). */
export const COUNTS_IN_HELP =
  "The round of the request this grant lowers, as of when it was placed (the Grants Register's rule)"

/**
 * One share's round as of its placement: R1 or R2, "after offer", else "—" with the Register's
 * reason words (OFFSET_WORDS) in the title. History never re-prices, so a share that couldn't be
 * priced says when.
 */
function countsInCell(share: CountsIn): { text: string; title: string } {
  if (share.offsets === 'round') {
    return share.round === 2
      ? {
          text: 'R2',
          title:
            'Counts in Round 2: known after Round 1 was posted, and these rules make an appeal subtract grants',
        }
      : { text: 'R1', title: 'Counts in Round 1: known before Round 1 was posted' }
  }
  if (share.offsets === 'after_offer') {
    return {
      text: 'after offer',
      title: 'Counts in no round: known after Round 1 was posted, so the offer stands',
    }
  }
  const why =
    share.offsets === 'not_priced'
      ? "it couldn't be priced when placed"
      : OFFSET_WORDS[share.offsets]
  return { text: '—', title: `Counts in no round: ${why}` }
}

/**
 * A placement's Round cell: each share's answer, the distinct ones joined in share order ("R1 · after
 * offer" for a grant split across requests). Null when the row carries none.
 */
export function countsInWords(
  counts: readonly CountsIn[] | null | undefined
): { text: string; title: string; muted: boolean } | null {
  if (!counts || counts.length === 0) return null
  const cells = counts.map(countsInCell)
  const distinct = (values: string[]) => [...new Set(values)].join(' · ')
  return {
    text: distinct(cells.map((c) => c.text)),
    title: distinct(cells.map((c) => c.title)),
    muted: counts.every((c) => c.offsets !== 'round'),
  }
}

export interface CompactGroup {
  readonly head: string
  readonly amountLabel: 'Amount' | 'Ask' | 'Grant placed'
  readonly rows: CompactRow[]
  readonly total: number | null
}

const COMPACT_ENTITIES: ReadonlySet<string> = new Set(['aid_decisions', 'aid_requests', PLACEMENTS])
const COMPACT_AT = 3

function compactRow(
  r: ApiAidHistoryRow,
  view: AidView,
  sessions?: ReadonlyMap<number, string>
): CompactRow {
  const household = r.household_cm_id
  const home = household === null ? null : householdHref(household, view)
  const roundText = r.after?.['round'] ?? r.before?.['round']
  const counts = r.entity === PLACEMENTS ? countsInWords(r.counts_in) : null
  const ask = r.entity === 'aid_requests' && r.action === 'create'
  const sessionFull = r.session_cm_id
    ? (sessions?.get(r.session_cm_id) ?? `Session ${String(r.session_cm_id)}`)
    : ''
  return {
    key: `${r.entity}:${r.entity_id}`,
    camper: r.camper_name ?? (r.entity === PLACEMENTS ? 'household request' : '—'),
    householdRequest: r.camper_name === null && r.entity === PLACEMENTS,
    camperHref: requestHref(r, household, view),
    household: household === null ? '—' : (r.household_name ?? `Household ${String(household)}`),
    householdHref: home,
    session: sessionFull === '' ? '—' : aidSessionName(sessionFull, undefined),
    sessionFull,
    round: counts?.text ?? (typeof roundText === 'number' ? `R${String(roundText)}` : null),
    roundMuted: counts?.muted ?? false,
    roundTitle: counts?.title ?? null,
    amount: decimalOf(
      r.entity === PLACEMENTS
        ? (placementAmount(r.after) ?? placementAmount(r.before))
        : ask
          ? r.after?.['ask']
          : (r.after?.['amount'] ?? r.before?.['amount'])
    ),
  }
}

/** A grant placement's amount, as the log nested it under the register row it recorded. */
function placementAmount(snapshot: Readonly<Record<string, unknown>> | null): unknown {
  const placement = snapshot?.['placement']
  return typeof placement === 'object' && placement !== null
    ? (placement as Record<string, unknown>)['amount']
    : undefined
}

/**
 * The camper link (spec §7.2 D, §7.5): the household page at the request's anchor, keeping the as-of.
 * Null without a household, a camper or a request id (a family-level row, or a row PR 3 could not place).
 */
export function requestHref(
  row: ApiAidHistoryRow,
  householdCmId: number | null,
  view: AidView
): string | null {
  if (householdCmId === null || !row.camper_name || !row.request_id) return null
  return `${householdHref(householdCmId, view)}#request-${row.request_id}`
}

/**
 * Each group of 3+ request rows with one action becomes a compact table; everything else stays a row
 * block. Grant placements group at 1+, only the `place` action: the removes that cancel a placement are
 * not listed, only counted (`omitted`) while a placements table is drawn.
 */
export function compactGroups(
  rows: readonly ApiAidHistoryRow[],
  view: AidView,
  sessions?: ReadonlyMap<number, string>
): { groups: CompactGroup[]; rest: ApiAidHistoryRow[]; omitted: number } {
  const buckets = new Map<string, ApiAidHistoryRow[]>()
  for (const r of rows) {
    if (!COMPACT_ENTITIES.has(r.entity)) continue
    if (r.entity === PLACEMENTS && r.action !== 'place') continue
    const key = `${r.entity}|${r.action}`
    buckets.set(key, [...(buckets.get(key) ?? []), r])
  }
  const grouped = new Set<ApiAidHistoryRow>()
  const groups: CompactGroup[] = []
  for (const [key, members] of buckets) {
    const [entity = '', action = ''] = key.split('|')
    if (members.length < (entity === PLACEMENTS ? 1 : COMPACT_AT)) continue
    members.forEach((m) => grouped.add(m))
    const compact = members.map((m) => compactRow(m, view, sessions))
    const amounts = compact.map((c) => c.amount).filter((a): a is number => a !== null)
    groups.push({
      head:
        entity === PLACEMENTS
          ? `${actionWords(entity, action)} · ${String(members.length)} grant placements`
          : `${actionWords(entity, action)} · ${String(members.length)} requests`,
      amountLabel:
        entity === PLACEMENTS
          ? 'Grant placed'
          : entity === 'aid_requests' && action === 'create'
            ? 'Ask'
            : 'Amount',
      rows: compact,
      total: amounts.length === 0 ? null : amounts.reduce((sum, a) => sum + a, 0),
    })
  }
  const placed = groups.some((g) => g.amountLabel === 'Grant placed')
  const dropped = (r: ApiAidHistoryRow) => placed && r.entity === PLACEMENTS && r.action !== 'place'
  return {
    groups,
    rest: rows.filter((r) => !grouped.has(r) && !dropped(r)),
    omitted: rows.filter(dropped).length,
  }
}

/** An intake run's other rows, counted: "55 × created · payer share · 57 × created · application". */
export function runSummary(rows: readonly ApiAidHistoryRow[]): string {
  const counts = new Map<string, { entity: string; action: string; n: number }>()
  for (const r of rows) {
    const key = `${r.entity}|${r.action}`
    const found = counts.get(key)
    if (found) found.n += 1
    else counts.set(key, { entity: r.entity, action: r.action, n: 1 })
  }
  return [...counts.values()]
    .map(
      ({ entity, action, n }) =>
        `${String(n)} × ${actionWords(entity, action).toLowerCase()} · ${recordWords(entity, 1)}`
    )
    .join(' · ')
}

// ── The opened row's right panel: Open (spec §7.2 D) ──────────────────────────

export interface OpenLinks {
  readonly households: Array<{ label: string; href: string }>
  readonly fullList: { label: string; href: string } | null
  readonly manyFamilies: string | null
  readonly rules: { label: string; href: string } | null
  readonly nothing: string | null
}

export function openLinks(
  op: ApiAidHistoryOperation,
  rows: readonly ApiAidHistoryRow[],
  view: AidView
): OpenLinks {
  const families = new Map<number, string>()
  for (const r of rows) {
    if (r.household_cm_id !== null && !families.has(r.household_cm_id)) {
      families.set(r.household_cm_id, r.household_name ?? `Household ${String(r.household_cm_id)}`)
    }
  }
  const requests = new Set(
    rows.filter((r) => r.camper_name !== null && r.request_id).map((r) => r.request_id)
  )
  const households =
    families.size >= 1 && families.size <= 3
      ? [...families].map(([id, name]) => ({ label: `${name} ›`, href: householdHref(id, view) }))
      : []
  const fullList =
    requests.size >= 3
      ? {
          label: `Full list in Requests (${String(requests.size)}) ›`,
          href: aidHref('/aid/requests', view, { op: op.operation_id }),
        }
      : null
  const manyFamilies =
    families.size > 3
      ? `${String(families.size)} families: each name in the list opens its household`
      : null
  const rules = rulesLink(op, view)
  const nothing =
    households.length === 0 && fullList === null && manyFamilies === null && rules === null
      ? 'Nothing to open: no household or rules version'
      : null
  return { households, fullList, manyFamilies, rules, nothing }
}
