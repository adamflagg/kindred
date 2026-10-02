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
import { aidHref, type AidView } from '../kit/asOf'
import { formatCampDateTime, parseIsoDay } from '../kit/dates'
import { CANCEL_REASON_OPTIONS } from '../kit/editor'
import type { PillTone } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { codeWords } from '../requests/attention'
import { changeWords, isRulesSection, SECTION_TITLES } from './rules/rulesModel'

// ── Filters and paging (D15: the view lives in the URL) ───────────────────────

/** One page of the log (the router allows up to 200). */
export const PER_PAGE = 50

/** Each kind's chip and pill words (D49's chips; intake is a tick, not a chip). */
export const KIND_LABELS = {
  rules: 'Rules',
  offers: 'Offers & stages',
  money: 'Money edits',
  holds: 'Holds',
  grants: 'Grants',
  intake: 'Intake',
} as const satisfies Record<ApiAidHistoryKind, string>

const CHIP_ORDER: readonly ApiAidHistoryKind[] = ['rules', 'offers', 'money', 'holds', 'grants']

/** The kind chips, in the spec's order; Rules only for `rules` (D49, D76). */
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

/** "1–50 of 312 operations"; nothing matching, or a page past the end, says so. */
export function pageWords(page: ApiAidHistoryPage): string {
  if (page.total === 0) return 'No operations match.'
  if (page.operations.length === 0) {
    return `Nothing on page ${String(page.page)}: ${String(page.total)} ${operations(page.total)} match${page.total === 1 ? 'es' : ''}.`
  }
  const first = (page.page - 1) * page.per_page + 1
  const last = first + page.operations.length - 1
  return `${String(first)}–${String(last)} of ${String(page.total)} ${operations(page.total)}`
}

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
  // "this figure is correct" over a corrected figure.
  aid_application_corrections: { correct: 'Corrected', cost_override: 'Cost override set' },
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
    set_headcount: 'Headcount set',
  },
  aid_grant_placements: { place: 'Placed', remove: 'Removed' },
  aid_rules: {
    create: 'Created',
    save: 'Saved',
    approve: 'Approved',
    lock: 'Locked',
    new_version: 'New version',
    start_from_last_year: 'Started from last year',
  },
  aid_session_capacity: { set_capacity: 'Capacity set' },
}

export function actionWords(entity: string, action: string): string {
  return ACTION_WORDS[entity]?.[action] ?? codeText(action)
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
 * An operation's line (D49; history.html B "What happened"): what was done to how many records,
 * from the server's counts, then, for an operation that touched the rules, its version, sections and
 * what was done to them. A round's first Posted tick locks its rules sections in the same operation
 * (plan review I1), so it reads "Posted · 380 decisions; Rules v3 · … · Locked", never the locks
 * alone. The reason follows as written (an approval's note names the approving body, D39). No names
 * and no totals: the read sends neither (Decision 1).
 */
export function operationWords(op: ApiAidHistoryOperation): OperationWords {
  const versioned = op.rules_versions.length > 0
  const parts = op.counts
    .filter((count) => !versioned || count.entity !== RULES)
    .map(
      (count) =>
        `${actionWords(count.entity, count.action)} · ${String(count.rows)} ${recordWords(count.entity, count.rows)}`
    )
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
 * so it reads as one line, never every setting as "added" (Decision 3).
 */
export function rulesLines(row: ApiAidHistoryRow): string[] {
  if (row.before === null) {
    const version = positiveInt(row.after, 'version')
    const parent = positiveInt(row.after, 'parent_version')
    const name = version === null ? 'A new version' : `New version v${String(version)}`
    return [
      `${name}${parent === null ? '' : `, from v${String(parent)}`}: its settings open in Rules`,
    ]
  }
  const lines: string[] = []
  for (const change of row.changes) {
    const [root, section, ...rest] = change.path
    if (section === undefined) continue
    if (root === 'document') {
      lines.push(
        rest.length === 0
          ? `${sectionTitle(section)}: ${change.kind}`
          : `${sectionTitle(section)} › ${changeWords({ ...change, path: rest })}`
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
/** Codes worded as the Requests grid words them (a hold's `code`: "Placeholder income"). */
const CODE_FIELDS: ReadonlySet<string> = new Set(['code'])
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

const isScalar = (value: unknown): boolean =>
  value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)

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

function fieldValue(entity: string, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (CODE_FIELDS.has(field) && typeof value === 'string') return codeWords(value)
  if (entity === 'aid_cancellations' && field === 'reason' && typeof value === 'string') {
    return CANCEL_REASON_WORDS.get(value) ?? value
  }
  const n = decimalOf(value)
  if (MONEY_FIELDS.has(field) && n !== null) return formatMoney(n)
  if (PERCENT_FIELDS.has(field) && n !== null) return `${String(value)}%`
  return String(value)
}

function fieldLine(entity: string, change: ApiAidFieldChange): string {
  const field = change.path[0] ?? ''
  const label = codeText(field)
  if (change.kind === 'added') return `${label}: ${fieldValue(entity, field, change.after)}`
  if (change.kind === 'removed')
    return `${label}: removed (was ${fieldValue(entity, field, change.before)})`
  return `${label}: ${fieldValue(entity, field, change.before)} → ${fieldValue(entity, field, change.after)}`
}

/** The household the row itself recorded, if it did (a create, or an update of that field). */
function householdOf(row: ApiAidHistoryRow): number | null {
  return positiveInt(row.after, 'household_cm_id') ?? positiveInt(row.before, 'household_cm_id')
}

export interface RowView {
  /** "Posted · decision req…:1 · <reason>" */
  readonly head: string
  readonly lines: readonly string[]
  /** Nested values the row recorded that are not listed. */
  readonly hidden: number
  readonly householdCmId: number | null
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

/** One row of an opened line: its action, record and reason, then the fields it recorded. */
export function rowView(row: ApiAidHistoryRow): RowView {
  if (row.entity === RULES) {
    return { head: rulesHead(row), lines: rulesLines(row), hidden: 0, householdCmId: null }
  }
  const topLevel = row.changes.filter((change) => change.path.length === 1)
  const unlisted = topLevel.filter((change) => UNLISTED.has(change.path[0] ?? ''))
  const listed = topLevel.filter(
    (change) =>
      !UNLISTED.has(change.path[0] ?? '') && isScalar(change.before) && isScalar(change.after)
  )
  return {
    head: joined([
      actionWords(row.entity, row.action),
      `${recordWords(row.entity, 1)} ${row.entity_id}`,
      row.reason,
    ]),
    lines: listed.map((change) => fieldLine(row.entity, change)),
    hidden: row.changes.length - listed.length - unlisted.length,
    householdCmId: householdOf(row),
  }
}

/**
 * "Open v4 in Rules ›" (D49): the newest version the operation touched, at the first section it
 * touched (an approval of two opens on the first, not the tab's default). The link keeps the page's
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
