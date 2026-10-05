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
  ApiAidHouseholdCard,
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
import { LIVE_REQUEST_STATUSES } from '../requests/gridEditor'
import { ROUND_STATUS_WORDS } from '../requests/stage'
import { CM_PENDING_WORD } from '../requests/views'

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
    return `${String(page.households.length)} households with a financial stake · opened from ${householdName(page, page.household_cm_id)}`
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
      return `${n} ${CM_PENDING_WORD}`
    case 'not_in_campminder':
      return `${n} missing in CM`
    case 'confirmed':
      return `${n} confirmed`
    case 'reversed':
      return `${n} reversed`
  }
}

/**
 * Posted's label in the band: "posted · 1 short $210" (B2, D77), and the mock's "posted · ✓ confirmed"
 * once every state is confirmed (D19).
 */
export function postedLabel(states: readonly ApiAidConfirmationState[]): string {
  if (states.length === 0) return 'posted'
  if (states.every((state) => state.status === 'confirmed')) return 'posted · ✓ confirmed'
  return `posted · ${states.map(stateWords).join(' · ')}`
}

export interface CardPill {
  readonly tone: PillTone
  readonly text: string
}

const CARD_PILL_TONE = {
  confirmed: 'emerald',
  short: 'amber',
  over: 'amber',
  not_in_campminder: 'amber',
  awaiting_sync: 'muted',
  reversed: 'stone',
} as const satisfies Record<ApiAidConfirmationState['status'], PillTone>

/**
 * A household card's confirmation as the mock's pills (D14): "✓ confirmed", or "CampMinder shows $Z"
 * beside an amber "short $W" (D59's amber). A household with several posted requests counts them,
 * since one card can then carry two states. Nothing posted, nothing drawn.
 */
export function cardConfirmation(card: ApiAidHouseholdCard): {
  shows: string | null
  pills: CardPill[]
} {
  const states = card.money.states
  const several = states.reduce((sum, state) => sum + state.count, 0) > 1
  const gapped = states.some((state) => state.status === 'short' || state.status === 'over')
  const inCampMinder = card.money.in_campminder
  return {
    shows: gapped && inCampMinder !== null ? `CampMinder shows ${formatMoney(inCampMinder)}` : null,
    pills: states.map((state) => {
      const words = stateWords(state)
      const counted = state.status === 'confirmed' ? `✓ ${words}` : words
      // stateWords leads with the count; one request on the card drops it ("short $210").
      const text = several ? counted : counted.replace(`${String(state.count)} `, '')
      return { tone: CARD_PILL_TONE[state.status], text }
    }),
  }
}

/** The card's second line (D15): "household 1000001 · Riverside, CA". */
export function cardPlaceLine(card: ApiAidHouseholdCard): string {
  return [`household ${String(card.household_cm_id)}`, card.city].filter(nonEmpty).join(' · ')
}

/** The card's third line (D15): the first adult, phone and email; a missing field drops out. */
export function cardContactLine(card: ApiAidHouseholdCard): string {
  const first = card.adults[0]?.replace(/\s*\(.*\)\s*$/, '') ?? ''
  return [first, card.phone, ...card.emails].filter(nonEmpty).join(' · ')
}

/** A blank family name reads as missing here, the one place names come from (the server never sends one today). */
export function householdName(page: ApiAidHouseholdPage, householdCmId: number): string {
  const name = page.households.find((h) => h.household_cm_id === householdCmId)?.family_name
  return name !== undefined && nonEmpty(name) ? name : `Household ${String(householdCmId)}`
}

/**
 * What a household CHIP says (O3): the short name, else the family name. `||`, not `??`: the server
 * defaults short_name to "" so `??` would never fall back. The band and sentences keep householdName.
 */
export function householdChipName(page: ApiAidHouseholdPage, householdCmId: number): string {
  const short = page.households.find((h) => h.household_cm_id === householdCmId)?.short_name
  return (short !== undefined && nonEmpty(short) ? short : '') || householdName(page, householdCmId)
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
  return { chip: householdChip(page, id) ?? 0, name: householdChipName(page, id) }
}

/**
 * The cost in a card's header. O6 (ruled 10-04 late, a number's meaning): a cancelled request still
 * shows the session's price, though the server leaves the row's cost out (it is excluded from the
 * band's totals, which keep "—"). The price is the one its receipt priced it at, the figure the
 * sentence already says ("of $3,600"). Nothing else borrows a cost.
 */
export function cardCost(request: ApiAidHouseholdRequest): number | null {
  if (request.row.cost !== null) return request.row.cost
  if (request.row.cancellation === null) return null
  const step = latestReceipt(request)?.trace.find((s) => s.key === 'cost')
  const value = step === undefined || step.value === null ? NaN : Number(step.value)
  return Number.isFinite(value) ? value : null
}

export function camperOf(request: ApiAidHouseholdRequest): string {
  return request.row.camper_name === '' ? 'Household request' : request.row.camper_name
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
  /** The round line's own meaning tone (O1); the header's Stage pill keeps the grid's tone. */
  readonly stateTone: RoundStateTone
  /** "locked Mar 9 · Test User", "locked Mar 10 · matched in CampMinder"; null until posted. */
  readonly lock: string | null
  readonly posted: boolean
  readonly postedOn: string | null
  readonly accepted: boolean
  /**
   * The round's CampMinder check is pending (`cm_pending`): C1, money already in CampMinder in full
   * that tonight's tick posts, or V1, a hand tick tonight's sync checks. The grid offers Accepted on
   * it (ticks.ts acceptedTarget), so the page does too.
   */
  readonly cmPending: boolean
  /** The server's sentence for a pending round (`cm_pending_message`, as the grid's detail line shows it). */
  readonly cmPendingMessage: string | null
  /**
   * A posted round whose money CampMinder reversed (D54): its `posted` still carries the locked
   * amount, but the budget counts that money nowhere, so it never reads as standing posted money.
   */
  readonly clawedBack: boolean
}

/**
 * O1 (ruled 10-04 late): the round line's pill carries what the state means, as the mock draws it
 * (Posted forest, Needs an offer sky, waiting on finance amber, On hold red; the rest stone). The
 * grid's per-round tones (`roundTone`) stay on the header's Stage pill, so it matches the grid row.
 */
export type RoundStateTone = 'posted' | 'offer' | 'finance' | 'hold' | 'stone'

const ROUND_STATE_TONE = {
  posted: 'posted',
  needs_offer: 'offer',
  pending_approval: 'finance',
  held: 'hold',
  not_decided: 'stone',
  refused: 'stone',
  not_rebuilt: 'stone',
} as const satisfies Record<ApiAidRound['status'], RoundStateTone>

/** The panel draws every live request as three round rows (O2): these are the ones not reached yet. */
export function unreachedRounds(request: ApiAidHouseholdRequest): number[] {
  const rounds = request.row.rounds
  if (rounds.length === 0 || requestStatusWords(request.row.request_status) !== null) return []
  return [1, 2, 3].filter((n) => !rounds.some((r) => r.round === n))
}

/** The round line's state word for a C1 round: the grid's pending word, sentence-cased. */
const PENDING_STATE_WORD = `${CM_PENDING_WORD.charAt(0).toUpperCase()}${CM_PENDING_WORD.slice(1)}`

export function roundLines(request: ApiAidHouseholdRequest): RoundLine[] {
  return [...request.row.rounds]
    .sort((a, b) => a.round - b.round)
    .map((r) => {
      const label = request.receipts.find((x) => x.round === r.round)?.label
      const posted = r.status === 'posted'
      const lockedOn = label?.locked_on ?? r.posted_on
      const byLedger = label?.lock_source === 'ledger' || r.lock_source === 'ledger'
      // B21 (ruled 10-04 late): the overnight tick is the normal path, worded as CampMinder's match.
      const who = byLedger ? 'matched in CampMinder' : (label?.ticked_by_name ?? null)
      const lock = posted
        ? [lockedOn ? `locked ${formatShortDate(lockedOn)}` : 'locked', who]
            .filter((part): part is string => part !== null)
            .join(' · ')
        : null
      const clawedBack = r.clawed_back ?? false
      const pending = r.status === 'pending_approval'
      const cmPending = r.cm_pending === true
      return {
        round: r.round,
        status: r.status,
        basis: posted ? 'posted' : pending ? 'pending' : 'decided',
        amount: posted ? r.posted : pending ? null : r.decided,
        pending: pending ? r.pending_approval : null,
        decided: r.decided,
        ask: r.ask,
        askedOn: r.asked_on,
        // B21 (owner, sitting B): a C1 round reads for what it is, waiting on tonight's tick, and
        // keeps the grid's own word for it (a needs-offer status is only the server's pre-tick state).
        // Owner ruling 10-05: a posted round CampMinder reversed says both, "Posted · reversed"
        // (household only: the grid's Stage pill keeps ROUND_STATUS_WORDS as the server sends them).
        words:
          cmPending && r.status === 'needs_offer'
            ? PENDING_STATE_WORD
            : clawedBack && posted
              ? `${ROUND_STATUS_WORDS.posted} · reversed`
              : ROUND_STATUS_WORDS[r.status],
        stateTone: cmPending && r.status === 'needs_offer' ? 'stone' : ROUND_STATE_TONE[r.status],
        lock,
        posted,
        postedOn: r.posted_on,
        accepted: r.accepted,
        cmPending,
        cmPendingMessage: cmPending ? (r.cm_pending_message ?? null) : null,
        clawedBack,
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

/** D34: the receipt opens by itself on a hold (owner Decision 1 dropped the would-change flag as a trigger). */
export function opensByItself(request: ApiAidHouseholdRequest): boolean {
  return request.row.holds.length > 0
}

/** A payer share's confirmation (D81), shaped for the kit's ConfirmationState; null until posted. */
export function shareConfirmation(share: ApiAidShareLine): ApiAidConfirmation | null {
  // No posted figure of its own (the shares don't split the posted total): the share carries the
  // request-wide CampMinder figure and state, which are not this payer's. Draw nothing (I2; D81).
  if (share.status === null || share.posted === null) return null
  const posted = share.posted
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

/**
 * Short words for the codes the calculator raises that the grid's map lacks. Each reads from the
 * engine's own message (calculator/engine.py); the banner still shows the server's message beside it.
 */
const HOLD_WORDS: Readonly<Record<string, string>> = {
  income_missing: 'Income missing',
  income_below_first_band: 'Income below first band',
  cost_unknown: 'Cost unknown',
  ask_missing: 'Ask missing',
  no_round1_table: 'No Round 1 table',
  rules_error: 'Rules error',
  unknown_program: 'Program not in the rules',
  program_closed: 'Program closed to aid',
  unknown_decision_type: 'Decision type not in the rules',
}

export function holdWords(code: string): string {
  return HOLD_WORDS[code] ?? codeWords(code)
}

/**
 * A request that isn't live says so (the page shows every request of its households, and a
 * non-live one keeps only its posted rounds). "Possible duplicate" is the grid's own phrase for
 * duplicate_pending (requests/attention.ts); the others name the server's status.
 */
const STATUS_WORDS: Readonly<Record<string, string>> = {
  duplicate_pending: 'Possible duplicate',
  duplicate: 'Duplicate',
  withdrawn: 'Withdrawn',
}

export function requestStatusWords(status: string | null): string | null {
  if (status === null || LIVE_REQUEST_STATUSES.includes(status)) return null
  return STATUS_WORDS[status] ?? codeWords(status)
}

const CANCEL_WORDS = new Map(CANCEL_REASON_OPTIONS.map((o) => [o.value, o.label] as const))

/** "Cancelled in the dashboard May 2 · declined: aid not enough / financial constraints" (D101, D141). */
export function cancellationWords(c: ApiAidCancellation): string {
  const where = c.by === 'kindred' ? 'Cancelled in the dashboard' : 'Cancelled in CampMinder'
  const on = c.on ? ` ${formatShortDate(c.on)}` : ''
  const reason =
    // B35 / ruling B: a reason is optional, so none reads as a fact, not a nag.
    c.reason === null ? 'none recorded' : (CANCEL_WORDS.get(c.reason) ?? c.reason)
  return [`${where}${on}`, reason, c.note].filter(nonEmpty).join(' · ')
}

// ── Income, grants, postings, history ───────────────────────────────────────

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  total_gross_income: 'Gross income',
  expected_gross_income: 'Expected gross income',
  total_adjusted_income: 'Adjusted income',
  income_confirmed: 'Prior-year confirmed income',
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
