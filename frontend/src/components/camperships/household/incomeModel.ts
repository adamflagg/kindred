/**
 * The household page's income, read for exceptions (owner pick 10-04: income (e) "Tabs +
 * exceptions"; N8). Staff only look at what is off: an answer corrected, an answer the form
 * changed since its correction, or an answer the campers' forms disagree on. Pure: every figure is
 * the server's, read as sent; nothing here prices anything.
 *
 * A flag is the server's own: `income_conflict` and `household_answer_conflict` carry
 * `detail.fields = {field: [{value, person_cm_ids}]}` (api/services/financial_aid_household.py
 * `choose_household_answers`) and `detail.resolved_by_correction` (financial_aid_casework_service.py
 * `_application_flags`). No last-year flag is raised here: the mock's "Down 38% on last year" had no
 * ruled threshold (coordinator, 10-04).
 */
import type {
  ApiAidAnswer,
  ApiAidHouseholdPage,
  ApiAidIncome,
  ApiAidReceipt,
} from '../../../types/api-types'
import { answerValue } from './householdModel'
import { formatMoney } from '../kit/money'

type Flag = ApiAidIncome['flags'][number]
type TraceStep = ApiAidReceipt['trace'][number]

const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'income_conflict',
  'household_answer_conflict',
])
const OVERRIDE_FIELD = 'income_override'

export interface Variant {
  readonly value: number
  readonly personCmIds: readonly number[]
}

/** One answer the forms disagree on. Resolved: corrected (or an income override), so no longer open. */
export interface FieldConflict {
  readonly code: string
  readonly field: string
  readonly variants: readonly Variant[]
  readonly resolved: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function variantOf(raw: unknown): Variant | null {
  if (!isRecord(raw) || typeof raw['value'] !== 'number') return null
  const ids = Array.isArray(raw['person_cm_ids'])
    ? raw['person_cm_ids'].filter((id): id is number => typeof id === 'number')
    : []
  return { value: raw['value'], personCmIds: ids }
}

/** Each conflicting answer of the household's conflict flags; a malformed detail reads as none. */
export function conflictsOf(income: ApiAidIncome): FieldConflict[] {
  return income.flags.flatMap((flag) => {
    if (!CONFLICT_CODES.has(flag.code)) return []
    const fields = flag.detail?.['fields']
    if (!isRecord(fields)) return []
    const resolved = flag.detail?.['resolved_by_correction'] === true
    return Object.entries(fields).flatMap(([field, raw]) => {
      if (!Array.isArray(raw)) return []
      const variants = raw.map(variantOf).filter((v): v is Variant => v !== null)
      return variants.length === 0 ? [] : [{ code: flag.code, field, variants, resolved }]
    })
  })
}

/** The household's other application flags (an amber pill each, in the grid's words). */
export function otherFlags(income: ApiAidIncome): Flag[] {
  return income.flags.filter((flag) => !CONFLICT_CODES.has(flag.code))
}

/** The answers worth a look, in the form's order: corrected, changed since, or in a conflict. */
export function exceptionsOf(income: ApiAidIncome): ApiAidAnswer[] {
  const conflicted = new Set(conflictsOf(income).map((c) => c.field))
  return income.answers.filter(
    (a) => a.corrected || a.changed_since_correction || conflicted.has(a.field)
  )
}

/** The toggle under the exceptions: "12 more answers match ▸" / "All 14 answers match ▸". */
export function moreWords(total: number, exceptions: number, open: boolean): string {
  if (open) return 'Show Only the Exceptions ▴'
  const rest = total - exceptions
  if (exceptions === 0) return `All ${String(rest)} answers match ▸`
  return rest === 1 ? '1 more answer matches ▸' : `${String(rest)} more answers match ▸`
}

const firstName = (name: string) => name.split(' ')[0] ?? name

/** The campers' first names for a variant, or null when any of its people is not a camper on the page. */
function namesOf(page: ApiAidHouseholdPage, ids: readonly number[]): string | null {
  const names = ids.map((id) => {
    const row = page.requests.find((r) => r.row.person_cm_id === id && id > 0)?.row
    return row === undefined || row.camper_name === '' ? null : `${firstName(row.camper_name)}'s`
  })
  const known = names.filter((n): n is string => n !== null)
  if (known.length === 0 || known.length < names.length) return null
  return listWords(known)
}

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  const last = items.at(-1) ?? ''
  return items.length <= 1 ? last : `${items.slice(0, -1).join(', ')} and ${last}`
}

/** A piece of the why line; `struck`: a form's figure the settling correction did not use. */
export interface WhyPart {
  readonly text: string
  readonly struck?: boolean
}

/**
 * The "why" line under a flagged answer, from the server's variants: "Emma's form says $84,000;
 * Samuel's says $90,000." Campers are named only when every variant's people are campers on the
 * page; otherwise it reads as "the campers' forms". A resolved conflict says what settled it, and
 * once a correction settles it, each form's figure the correction did not use is struck (round 3,
 * section 3: the other form's figure struck in red).
 */
export function conflictParts(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome,
  conflict: FieldConflict
): WhyPart[] {
  const used = income.answers.find((a) => a.field === conflict.field)
  const settledByCorrection = conflict.resolved && used?.corrected === true
  const value = (v: Variant): WhyPart => ({
    text: answerValue(conflict.field, String(v.value)),
    ...(settledByCorrection && v.value !== Number(used.effective) ? { struck: true } : {}),
  })
  const named = conflict.variants.map((v) => ({ v, who: namesOf(page, v.personCmIds) }))
  let parts: WhyPart[]
  if (named.every(({ who }) => who !== null)) {
    parts = named.flatMap(({ v, who }, i) => {
      const several = v.personCmIds.length > 1
      const lead =
        i === 0
          ? `${who ?? ''} ${several ? 'forms say' : 'form says'} `
          : `; ${who ?? ''} ${several ? 'say' : 'says'} `
      return [{ text: lead }, value(v)]
    })
  } else if (conflict.variants.length === 2) {
    const [a, b] = conflict.variants as [Variant, Variant]
    parts = [
      { text: "The campers' forms disagree: " },
      value(a),
      { text: ' on one, ' },
      value(b),
      { text: ' on another' },
    ]
  } else {
    const values = conflict.variants.map(value)
    parts = [{ text: "The campers' forms disagree: " }]
    values.forEach((part, i) => {
      if (i > 0) parts.push({ text: i === values.length - 1 ? ' and ' : ', ' })
      parts.push(part)
    })
  }
  if (!conflict.resolved) return [...parts, { text: '.' }]
  const overridden =
    income.answers.find((a) => a.field === OVERRIDE_FIELD)?.effective.trim() !== '' &&
    used?.corrected !== true
  return [
    ...parts,
    { text: `. ${overridden ? 'The income override' : 'The correction'} settles it.` },
  ]
}

/** The why line as one sentence. */
export function conflictWords(
  page: ApiAidHouseholdPage,
  income: ApiAidIncome,
  conflict: FieldConflict
): string {
  return conflictParts(page, income, conflict)
    .map((part) => part.text)
    .join('')
}

/** One household's open flags: each open conflicting answer, and each other flag. */
export function incomeFlagCount(income: ApiAidIncome): number {
  return conflictsOf(income).filter((c) => !c.resolved).length + otherFlags(income).length
}

/** The page's open flags, per concern: a flag opens Income by itself. */
export function openFlagCount(page: ApiAidHouseholdPage): number {
  return page.incomes.reduce((n, income) => n + incomeFlagCount(income), 0)
}

/** Two or more campers' forms in one household: there is something for the forms to agree on. */
function formsToCompare(page: ApiAidHouseholdPage, householdCmId: number): boolean {
  const campers = new Set(
    page.requests
      .filter((r) => r.row.household_cm_id === householdCmId && r.row.person_cm_id > 0)
      .map((r) => r.row.person_cm_id)
  )
  return campers.size > 1
}

/**
 * The Income tab's meta: the flag count when anything is open; otherwise how many answers are
 * corrected, and "forms agree ✓" only when there are forms to compare and none disagree.
 */
export function incomeTabMeta(page: ApiAidHouseholdPage): {
  flags: number
  words: string | null
} {
  const flags = openFlagCount(page)
  if (flags > 0) return { flags, words: null }
  if (page.incomes.length === 0) return { flags: 0, words: 'no form on file' }
  const corrected = page.incomes.reduce(
    (n, income) => n + income.answers.filter((a) => a.corrected).length,
    0
  )
  const agree =
    page.incomes.some((income) => formsToCompare(page, income.household_cm_id)) &&
    page.incomes.every((income) => conflictsOf(income).length === 0)
  const count = corrected === 0 ? 'no corrections' : `${String(corrected)} corrected`
  return { flags: 0, words: agree ? `${count} · forms agree ✓` : count }
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** The Grants and postings tab's meta; the Expected count shows apart, as a sky pill. */
export function grantsTabMeta(page: ApiAidHouseholdPage): { words: string; expected: number } {
  return {
    words: `${plural(page.grants.length, 'grant', 'grants')} · ${plural(page.postings.length, 'posting', 'postings')}`,
    expected: page.expected.length,
  }
}

// ── Last year's line (round 3, section 4 (E)) ──────────────────────────────

/** The two figures the Income tab's last-year line compares, as the page already has them. */
export interface PricedFacts {
  /** The trace's adjusted household income: the figure the card's sentence names. */
  readonly adjusted: number | null
  /** The form's prior-year confirmed income, as used. */
  readonly confirmed: number | null
}

const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const stepValue = (trace: readonly TraceStep[], key: string): number | null =>
  numberOf(trace.find((s) => s.key === key)?.value)

/**
 * The receipt that priced a household: a live one first (today's pricing), else the latest
 * locked one (as it was when posted). Only the household's own requests: the other household's
 * form prices its own.
 */
function pricingReceipt(page: ApiAidHouseholdPage, householdCmId: number): ApiAidReceipt | null {
  const receipts = page.requests
    .filter((r) => r.row.household_cm_id === householdCmId)
    .flatMap((r) => r.receipts)
    .filter((r) => r.trace.some((s) => s.key === 'adjusted_income'))
  const live = receipts.filter((r) => r.label.kind === 'live')
  const pool = live.length > 0 ? live : receipts
  return pool.reduce<ApiAidReceipt | null>(
    (best, r) => (best === null || r.round > best.round ? r : best),
    null
  )
}

/**
 * The last-year line's figures, from the payload only: this year's adjusted income from the
 * household's receipt trace, last year's confirmed income from its answer. A figure the payload
 * lacks is null, never faked.
 */
export function pricedFacts(page: ApiAidHouseholdPage, income: ApiAidIncome): PricedFacts {
  const receipt = pricingReceipt(page, income.household_cm_id)
  const trace = receipt?.trace ?? []
  const confirmed = numberOf(income.answers.find((a) => a.field === 'income_confirmed')?.effective)
  return { adjusted: stepValue(trace, 'adjusted_income'), confirmed }
}

export interface LastYearWords {
  /** "$96,500": last year's confirmed income. */
  readonly confirmed: string
  /** "this year's adjusted is 14% lower"; null with nothing to compare. */
  readonly compare: string | null
}

const toCents = (n: number) => Math.round(n * 100)

/**
 * The Income tab's quiet last-year line (round 3 (E)): last year's confirmed income, and how this
 * year's adjusted income compares, as a whole percentage of last year's. Rounding: the gap's size
 * is rounded half away from zero (|gap| × 100 / last year, then Math.round on that non-negative
 * figure), so a gap reads the same up or down. "The same" is only for figures equal to the cent;
 * a gap that rounds to 0% says "under 1%" rather than claim none. No line without last year;
 * only its first half without an adjusted income, or with last year at $0 or below.
 */
export function lastYearWords(
  adjusted: number | null,
  confirmed: number | null
): LastYearWords | null {
  if (confirmed === null) return null
  const words = formatMoney(confirmed)
  if (adjusted === null || confirmed <= 0) return { confirmed: words, compare: null }
  const gap = toCents(adjusted) - toCents(confirmed)
  if (gap === 0) return { confirmed: words, compare: "this year's adjusted is the same" }
  const pct = Math.round((Math.abs(gap) * 100) / toCents(confirmed))
  const way = gap > 0 ? 'higher' : 'lower'
  return {
    confirmed: words,
    compare: `this year's adjusted is ${pct === 0 ? 'under 1' : String(pct)}% ${way}`,
  }
}
