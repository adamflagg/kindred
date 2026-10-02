/**
 * The household page's words and figures (§6.3; D26, D32, D50–D52, D59, D77, D81, D127; slice 1
 * Decisions 18–22, 35). Pure: the components only draw them. Every figure is the server's; nothing
 * here adds money up except a per-share gap, to the cent.
 */
import type {
  ApiAidCancellation,
  ApiAidConfirmation,
  ApiAidConfirmationState,
  ApiAidExpected,
  ApiAidHistoryEntry,
  ApiAidHouseholdCard,
  ApiAidHouseholdLink,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidReceipt,
  ApiAidRound,
  ApiAidShareLine,
} from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { CANCEL_REASON_OPTIONS } from '../kit/editor'
import type { PillTone } from '../kit/kitStyles'
import { formatMoney, moneyCsv, toCents } from '../kit/money'
import { codeWords } from '../requests/attention'
import { ROUND_STATUS_WORDS, roundTone } from '../requests/stage'

const nonEmpty = (text: string) => text.trim() !== ''

// ── The band and the cards ──────────────────────────────────────────────────

/** "The Johnson Family / The Garcia Family": the server's names, no "family" added (#2924 shape 7). */
export function bandTitle(page: ApiAidHouseholdPage): string {
  const names = page.households.map((h) => h.family_name).filter(nonEmpty)
  return names.length > 0 ? names.join(' / ') : `Household ${String(page.household_cm_id)}`
}

/** One household: its details fold in (D32). Several: how many, and which one it was opened from. */
export function bandSubtitle(page: ApiAidHouseholdPage): string {
  const opened = page.households.find((h) => h.household_cm_id === page.household_cm_id)
  if (page.households.length > 1) {
    return `${String(page.households.length)} households with a financial stake · opened from ${opened?.family_name ?? `household ${String(page.household_cm_id)}`}`
  }
  const card = opened ?? page.households[0]
  if (card === undefined) return `household ${String(page.household_cm_id)}`
  return [
    card.adults.join(' · '),
    `household ${String(card.household_cm_id)}`,
    card.phone,
    card.city,
  ]
    .filter(nonEmpty)
    .join(' · ')
}

/** "1 short $210" (D59's words; a state's gap is in CampMinder minus posted, so short is negative). */
export function stateWords(state: ApiAidConfirmationState): string {
  const n = String(state.count)
  switch (state.status) {
    case 'short':
      return `${n} short ${formatMoney(Math.abs(state.gap))}`
    case 'over':
      return `${n} over ${formatMoney(Math.abs(state.gap))}`
    case 'awaiting_sync':
      return `${n} awaiting tonight's sync`
    case 'not_in_campminder':
      return `${n} not in CampMinder`
    case 'confirmed':
      return `${n} confirmed`
    case 'reversed':
      return `${n} reversed`
  }
}

/** Posted's label in the band and on the cards: "posted · 1 short $210" (B2, D77). */
export function postedLabel(states: readonly ApiAidConfirmationState[]): string {
  return states.length === 0 ? 'posted' : `posted · ${states.map(stateWords).join(' · ')}`
}

export function householdName(page: ApiAidHouseholdPage, householdCmId: number): string {
  return (
    page.households.find((h) => h.household_cm_id === householdCmId)?.family_name ??
    `Household ${String(householdCmId)}`
  )
}

export function householdChip(page: ApiAidHouseholdPage, householdCmId: number): number | null {
  return page.households.find((h) => h.household_cm_id === householdCmId)?.chip ?? null
}

export const multiHousehold = (page: ApiAidHouseholdPage): boolean => page.households.length > 1

const requestOf = (page: ApiAidHouseholdPage, requestId: string) =>
  page.requests.find((r) => r.row.request_id === requestId)

const firstName = (name: string) => name.split(' ')[0] ?? name

/** Which shares a household pays: "60% of Emma, all of Samuel" (household-totals.html). */
export function cardShares(card: ApiAidHouseholdCard, page: ApiAidHouseholdPage): string {
  return card.request_ids
    .map((requestId) => {
      const request = requestOf(page, requestId)
      if (request === undefined) return null
      const who =
        request.row.camper_name === ''
          ? 'the household request'
          : firstName(request.row.camper_name)
      const share = request.shares.find((s) => s.household_cm_id === card.household_cm_id)
      // A household with no payer-share line pays nothing: if it applied, say so and claim no share.
      // (The server already supplies an implied 100% line when a request has no shares at all.)
      if (share === undefined) {
        return request.row.household_cm_id === card.household_cm_id ? `applied for ${who}` : null
      }
      return share.share_pct === 100 ? `all of ${who}` : `${String(share.share_pct)}% of ${who}`
    })
    .filter((words): words is string => words !== null)
    .join(', ')
}

/** "applied by" on a request card, only when several households are on the page (D32). */
export function appliedBy(
  request: ApiAidHouseholdRequest,
  page: ApiAidHouseholdPage
): { chip: number; name: string } | null {
  if (!multiHousehold(page)) return null
  const id = request.row.household_cm_id
  return { chip: householdChip(page, id) ?? 0, name: householdName(page, id) }
}

export function camperOf(request: ApiAidHouseholdRequest): string {
  return request.row.camper_name === '' ? 'Household request' : request.row.camper_name
}

/** The person to open in CampMinder for a household card: its first camper on the page, by name (Decision 20; M12). */
export function firstCamperOf(
  page: ApiAidHouseholdPage,
  householdCmId: number
): { readonly personCmId: number; readonly name: string } | null {
  const row = page.requests.find(
    (r) => r.row.household_cm_id === householdCmId && r.row.person_cm_id > 0
  )?.row
  return row ? { personCmId: row.person_cm_id, name: row.camper_name } : null
}

/** CampMinder's person record, the one CampMinder link the app already uses. */
export function campMinderPersonUrl(personCmId: number, year: number): string {
  return `https://system.campminder.com/ui/person/Record#${String(personCmId)}:${String(year)}`
}

// ── The decision panel ──────────────────────────────────────────────────────

/** What a line's amount is (plan review number-meaning fix 3): the lock, the decided amount, or a pending one. */
export type RoundBasis = 'posted' | 'decided' | 'pending'

export interface RoundLine {
  readonly round: number
  readonly status: ApiAidRound['status']
  readonly basis: RoundBasis
  /**
   * Posted: the locked amount. Otherwise the decided amount. Never a pending one: the Total under
   * the column is `total_decided`, which leaves an unapproved Round 3 out (§5.3).
   */
  readonly amount: number | null
  /** A Round 3 amount waiting on finance, drawn amber beside the amounts as the grid does; else null. */
  readonly pending: number | null
  readonly decided: number | null
  /** The family's ask for this round and the day it came ("ask $1,200 · Apr 9"; I6). */
  readonly ask: number | null
  readonly askedOn: string | null
  readonly words: string
  readonly tone: PillTone
  /** "locked Mar 9 · Test User", "locked Mar 10 · by the ledger match"; null until posted. */
  readonly lock: string | null
  readonly posted: boolean
  readonly postedOn: string | null
  readonly accepted: boolean
  /** A locked round's "would change by $X" (D43); null when nothing would. */
  readonly wouldChangeBy: number | null
}

export function roundLines(request: ApiAidHouseholdRequest): RoundLine[] {
  return [...request.row.rounds]
    .sort((a, b) => a.round - b.round)
    .map((r) => {
      const label = request.receipts.find((x) => x.round === r.round)?.label
      const posted = r.status === 'posted'
      const lockedOn = label?.locked_on ?? r.posted_on
      const byLedger = label?.lock_source === 'ledger' || r.lock_source === 'ledger'
      const who = byLedger ? 'by the ledger match' : (label?.ticked_by_name ?? null)
      const lock = posted
        ? [lockedOn ? `locked ${formatShortDate(lockedOn)}` : 'locked', who]
            .filter((part): part is string => part !== null)
            .join(' · ')
        : null
      const would = r.would_change_by ?? null
      const pending = r.status === 'pending_approval'
      return {
        round: r.round,
        status: r.status,
        basis: posted ? 'posted' : pending ? 'pending' : 'decided',
        amount: posted ? r.posted : pending ? null : r.decided,
        pending: pending ? r.pending_approval : null,
        decided: r.decided,
        ask: r.ask,
        askedOn: r.asked_on,
        words: ROUND_STATUS_WORDS[r.status],
        tone: roundTone(r),
        lock,
        posted,
        postedOn: r.posted_on,
        accepted: r.accepted,
        wouldChangeBy: would !== null && would !== 0 ? would : null,
      }
    })
}

// ── Receipts and shares ─────────────────────────────────────────────────────

/** The latest round's receipt shows under the card's sentence (Decision 35). */
export function latestReceipt(request: ApiAidHouseholdRequest): ApiAidReceipt | undefined {
  return request.receipts.reduce<ApiAidReceipt | undefined>(
    (latest, r) => (latest === undefined || r.round > latest.round ? r : latest),
    undefined
  )
}

export function earlierReceipts(request: ApiAidHouseholdRequest): ApiAidReceipt[] {
  const latest = latestReceipt(request)
  return request.receipts.filter((r) => r !== latest).sort((a, b) => a.round - b.round)
}

/** D34: the receipt opens by itself on a hold, or while a "would change by" flag shows. */
export function opensByItself(request: ApiAidHouseholdRequest): boolean {
  return (
    request.row.holds.length > 0 || request.row.rounds.some((r) => (r.would_change_by ?? 0) !== 0)
  )
}

/** A payer share's confirmation (D81), shaped for the kit's ConfirmationState; null until posted. */
export function shareConfirmation(share: ApiAidShareLine): ApiAidConfirmation | null {
  if (share.status === null) return null
  const posted = share.posted ?? 0
  const inCampMinder = share.in_campminder ?? 0
  return {
    status: share.status,
    locked: posted,
    in_campminder: inCampMinder,
    gap: (toCents(inCampMinder) - toCents(posted)) / 100,
    on: null,
    reconciled: share.status === 'confirmed',
    family_unplaced: 0,
    shares: [],
  }
}

const CANCEL_WORDS = new Map(CANCEL_REASON_OPTIONS.map((o) => [o.value, o.label] as const))

/** "Cancelled in Kindred May 2 · declined: aid not enough / financial constraints" (D101, D141). */
export function cancellationWords(c: ApiAidCancellation): string {
  const where = c.by === 'kindred' ? 'Cancelled in Kindred' : 'Cancelled in CampMinder'
  const on = c.on ? ` ${formatShortDate(c.on)}` : ''
  const reason =
    c.reason === null ? 'no reason given yet' : (CANCEL_WORDS.get(c.reason) ?? c.reason)
  return [`${where}${on}`, reason, c.note].filter(nonEmpty).join(' · ')
}

// ── Income, grants, postings, history ───────────────────────────────────────

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  total_gross_income: 'Gross income',
  expected_gross_income: 'Expected gross income',
  total_adjusted_income: 'Adjusted income',
  income_confirmed: 'Income confirmed',
  total_medical_expenses: 'Medical expenses',
  total_edu_expenses: 'Education expenses',
  total_housing_expenses: 'Housing expenses',
  total_rent: 'Rent',
  non_retirement_savings: 'Savings (not retirement)',
  num_children: 'Children',
  // Correction-only: the server sends it once staff correct it (APPLICATION_CORRECTABLE).
  income_override: 'Income override',
}

export function answerWords(field: string): string {
  return ANSWER_WORDS[field] ?? codeWords(field)
}

const COUNT_FIELDS = new Set(['num_children'])
const NUMBER = /^-?\d+(\.\d+)?$/

const OVERRIDE_MODE_WORDS: Readonly<Record<string, string>> = {
  prior_year_only: 'Prior year only',
  current_year_only: 'Current year only',
  confirmed_prior_year: 'Confirmed from prior year',
}

/** The server's four override values: three modes, and "staff_entered:<amount>" (financial_aid_corrections.py). */
function incomeOverrideWords(value: string): string {
  const entered = /^staff_entered:(-?\d+(\.\d+)?)$/.exec(value)
  if (entered?.[1] !== undefined) return `Staff entered ${formatMoney(Number(entered[1]))}`
  return OVERRIDE_MODE_WORDS[value] ?? value
}

/** An answer as staff read it: money, a count, Yes/No, or "—" when blank (spec principle 5). */
export function answerValue(field: string, value: string): string {
  if (value === '') return '—'
  if (value === 'true') return 'Yes'
  if (value === 'false') return 'No'
  if (field === 'income_override') return incomeOverrideWords(value)
  if (COUNT_FIELDS.has(field) || !NUMBER.test(value)) return value
  return formatMoney(Number(value))
}

const NOTE_WORDS: Readonly<Record<string, string>> = {
  special_circumstances: 'Special financial circumstances',
  other_support_expectations: 'Other support expected',
}

export function noteWords(key: string): string {
  return NOTE_WORDS[key] ?? codeWords(key)
}

// One entry per kind, so a new kind on the server fails tsc here rather than borrowing a word (M3).
const EXPECTED_WORDS = {
  synagogue: 'Expected: synagogue grant',
  one_happy_camper: 'Expected: incentive grant (family says it applied)',
} as const satisfies Record<ApiAidExpected['kind'], string>

/** D56's Expected chip, naming no funder (Decision 21). */
export function expectedWords(expected: ApiAidExpected): string {
  return [EXPECTED_WORDS[expected.kind], ...expected.camper_names].join(' · ')
}

/** "test@example.com · Tick posted · decision events reqsamuel000005:1 · Entered in CampMinder". */
export function historyLine(entry: ApiAidHistoryEntry): string {
  const record = `${entry.entity.replace(/^aid_/, '').replaceAll('_', ' ')} ${entry.entity_id}`
  return [entry.actor, codeWords(entry.action), record, entry.reason].filter(nonEmpty).join(' · ')
}

/** A linked household (§6.3 †; Decision 27: read only). */
export function linkWords(link: ApiAidHouseholdLink): string {
  return [
    `household ${String(link.household_cm_id)}`,
    link.source,
    link.excluded ? 'excluded' : '',
    link.note,
  ]
    .filter(nonEmpty)
    .join(' · ')
}

export interface CsvTable {
  readonly headers: string[]
  readonly rows: string[][]
}

/** The family's posting history (D127; §11, RPT-25): every line, live and reversed. */
export function postingsCsv(page: ApiAidHouseholdPage): CsvTable {
  return {
    headers: [
      'Posted on',
      'Household',
      'Amount',
      'Reversed on',
      'Source',
      'Person id',
      'Session id',
      'Program',
      'Note',
    ],
    rows: page.postings.map((p) => [
      p.post_date,
      String(p.household_cm_id),
      moneyCsv(p.amount),
      p.reversal_date,
      p.effective_source_key,
      p.attributed_person_cm_id > 0 ? String(p.attributed_person_cm_id) : '',
      p.attributed_session_cm_id > 0 ? String(p.attributed_session_cm_id) : '',
      p.program_family,
      p.transaction_note,
    ]),
  }
}

/** The family's history timeline (§6.3 item 7). */
export function historyCsv(page: ApiAidHouseholdPage): CsvTable {
  return {
    headers: ['When', 'Who', 'Action', 'Record', 'Reason', 'Operation'],
    rows: page.history.map((h) => [
      h.at,
      h.actor,
      h.action,
      `${h.entity} ${h.entity_id}`,
      h.reason,
      h.operation_id,
    ]),
  }
}

/** Decision 32: camperships-household-<id>-<postings|history>-<season>.csv. */
export function householdCsvName(page: ApiAidHouseholdPage, part: 'postings' | 'history'): string {
  return aidCsvFilename({
    surface: 'household',
    view: String(page.household_cm_id),
    filters: [part],
    season: page.year,
  })
}
