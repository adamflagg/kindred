/**
 * Each Rules card's content (spec §6.2 D, E; rules-v3.html's RENDER after Fix 1): plain rows of label · value ·
 * description, sub-heads, and a read-only strip. Hidden settings (§6.4) are in no row and never render; read-only
 * ones never get a control. Pure.
 */
import type { ApiAidRulesSection, ApiAidValidationIssue } from '../../../../types/api-types'
import { formatLongDate } from '../../kit/dates'
import { formatMoney } from '../../kit/money'
import { codeWords } from '../../requests/attention'
import { keyWords, labelOf, type RulesNames } from './rulesModel'
import { valueAt } from './sectionEdit'

export type RowType =
  | 'money'
  | 'money?'
  | 'pct?'
  | 'frac'
  | 'int?'
  | 'weight'
  | 'bool'
  | 'date?'
  | 'choice'
  | 'programs'

export interface CardRow {
  readonly path: readonly string[]
  readonly label: string
  readonly desc: string
  readonly type: RowType
  readonly nullWord?: string
}

export interface CardGroup {
  readonly head: string | null
  readonly rows: readonly CardRow[]
}

export interface ReadOnlyItem {
  readonly path: readonly string[]
  readonly label: string
  readonly type: RowType
  readonly desc?: string
}

export interface CardSpec {
  readonly lead: string | null
  readonly groups: readonly CardGroup[]
  readonly readOnly: readonly ReadOnlyItem[]
}

const row = (
  path: string[],
  label: string,
  desc: string,
  type: RowType,
  nullWord?: string
): CardRow =>
  nullWord === undefined ? { path, label, desc, type } : { path, label, desc, type, nullWord }

export const CARD_SPECS: Readonly<Partial<Record<ApiAidRulesSection, CardSpec>>> = {
  income: {
    lead: null,
    groups: [
      {
        head: 'Which years count',
        rows: [
          row(['weights', 'prior_year'], 'Prior-year weight', '', 'frac'),
          row(
            ['basis'],
            'Prior-year income measure',
            '"The confirmed figure" falls back to gross income when a family has none.',
            'choice'
          ),
          row(['current_year_zero_fallback'], "When this year's income is $0", '', 'choice'),
        ],
      },
      {
        head: 'Expenses and savings',
        rows: [
          row(['medical_threshold'], 'Medical expenses count above', '', 'money'),
          row(['education_threshold'], 'Education expenses count above', '', 'money'),
          row(['savings_threshold'], 'Savings count above', '', 'money'),
        ],
      },
      {
        head: 'Dependents',
        rows: [
          row(
            ['dependents_mode'],
            'Dependents',
            'Move the tier through the "Dependents at or above 3" equity criterion, or lower the income by an amount each. Never both.',
            'choice'
          ),
          row(
            ['per_dependent_reduction'],
            'Taken off per dependent',
            'Comes off the counted income for each dependent',
            'money'
          ),
        ],
      },
    ],
    readOnly: [{ path: ['weights', 'current_year'], label: 'Current-year weight', type: 'frac' }],
  },
  equity: {
    lead: "A criterion that isn't enabled counts for nobody and keeps its weights.",
    groups: [
      {
        head: null,
        rows: [row(['max_shift'], 'Most tiers a family can move', '', 'int?', 'No limit')],
      },
    ],
    readOnly: [
      {
        path: ['aggregation'],
        label: 'Rounding the total',
        type: 'choice',
        desc: 'so a single 0.5 moves a whole tier',
      },
    ],
  },
  awards: {
    lead: null,
    groups: [{ head: null, rows: [row(['minimum'], 'Minimum award', '', 'money')] }],
    readOnly: [],
  },
  round3: {
    lead: null,
    groups: [
      {
        head: null,
        rows: [
          row(
            ['registrar_limit'],
            "The registrar's limit",
            'A larger amount waits for finance as Pending approval.',
            'money?',
            'No limit: every amount waits'
          ),
          row(['max_amount'], 'Most per request', '', 'money?', 'No limit'),
          row(['max_total_pct_of_cost'], 'Most, as a share of the cost', '', 'pct?', 'No limit'),
        ],
      },
    ],
    readOnly: [
      { path: ['require_round2'], label: 'Needs a Round 2 decision first', type: 'bool' },
      { path: ['require_statement_of_need'], label: 'Needs a statement of need', type: 'bool' },
    ],
  },
  quality_checks: {
    lead: 'A check that holds stops the request until staff look; a warning only informs. The list of checks is read-only.',
    groups: [],
    readOnly: [],
  },
  programs: { lead: null, groups: [], readOnly: [] },
  cost: { lead: null, groups: [], readOnly: [] },
  milestones: {
    lead: 'The application deadline is also the default "received through" date for reports and what-ifs.',
    groups: [
      {
        head: 'Applications and Round 1',
        rows: [
          row(['application_deadline'], 'Application deadline', '', 'date?'),
          row(['r1_run'], 'Round 1 run', '', 'date?'),
          row(['response_deadline'], 'Response deadline', '', 'date?'),
        ],
      },
      {
        head: 'Round 2 and Round 3',
        rows: [
          row(['r2_window_start'], 'Round 2 opens', '', 'date?'),
          row(['r2_window_end'], 'Round 2 closes', '', 'date?'),
          row(['r3_window_start'], 'Round 3 opens', '', 'date?'),
          row(['r3_window_end'], 'Round 3 closes', '', 'date?'),
        ],
      },
    ],
    readOnly: [],
  },
  grants: {
    lead: null,
    groups: [
      {
        head: null,
        rows: [
          row(
            ['offset_programs'],
            'Programs grants offset',
            'Outside grants reduce camp aid only in these programs.',
            'programs'
          ),
          row(
            ['offset_mode'],
            'How a grant offsets',
            'Dollar for dollar off the Round 1 award, or off the cost before the Round 1 % applies.',
            'choice'
          ),
        ],
      },
    ],
    readOnly: [
      { path: ['late_grant_policy'], label: 'A grant recorded after Round 1', type: 'choice' },
      {
        path: ['minimum_after_grants'],
        label: 'The minimum is paid on top of a partial grant',
        type: 'bool',
      },
      {
        path: ['minimum_capped_at_share'],
        label: 'A grant plus the minimum never passes the cost',
        type: 'bool',
      },
    ],
  },
}

/** The hidden settings (§6.4), dotted within their section: no card row or strip names one. */
export const HIDDEN_PATHS: readonly string[] = [
  'medical_rate',
  'education_rate',
  'savings_inclusion_rate',
  'extra_terms',
  'floor',
  'floor_applies_after',
  'floor_tier',
  'minimum_when_cost_unknown',
  'ask_cap',
  'rounding',
  'count_when',
  'minimum_when_fully_covered',
  'cap_subtracts_grants',
  'cap_by_original_ask',
  'total_cap',
  'infant_age_cutoff_months',
  'override_reasons',
]

export const CHOICE_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  basis: { gross: 'Gross income', agi: 'AGI', confirmed: 'The confirmed figure' },
  current_year_zero_fallback: {
    blend: 'Keep the blend',
    prior_year_only: 'Use the prior year alone',
  },
  dependents_mode: {
    tier_shift: 'Move the tier',
    income_reduction: 'Lower the income',
    none: 'Not counted',
  },
  aggregation: { ceil: 'Round up', round: 'Round to nearest', floor: 'Round down' },
  offset_mode: { dollar: 'Dollar for dollar', reduce_cost_basis: 'Off the cost first' },
  late_grant_policy: {
    ignore: 'Leave it out',
    flag: 'Leave it out, flag it',
    recalculate: 'Count it, re-price',
  },
  kind: {
    full_cost: 'Full cost',
    full_cost_after_aid: 'Full cost after camp aid',
    discretionary: 'Staff type the amount',
    top_up: 'Fixed top-up',
  },
  match: { equals_any: 'is', contains_any: 'contains', at_least: 'at least' },
  cost_source: { catalog: 'Session price', per_person: 'Per person', typed: 'Typed by staff' },
  severity: { hold: 'Hold', warn: 'Warning' },
}

const number = (value: unknown) =>
  typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
const trimmed = (n: number) => String(Number(n.toFixed(4)))

/** A setting as staff read it: whole dollars (owner round 1: "if we're rounding to the whole dollar why are we even
 * showing that?"), % for shares and fractions, ✓ for yes, a long date, a choice's words. */
export function settingText(
  value: unknown,
  type: RowType,
  path: readonly string[],
  names: RulesNames,
  nullWord?: string
): string {
  if (value === null || value === undefined || value === '')
    return nullWord ?? (type === 'date?' ? 'Not set' : '—')
  const field = path.at(-1) ?? ''
  switch (type) {
    case 'money':
    case 'money?':
      return formatMoney(Math.round(number(value)))
    case 'pct?':
      return `${trimmed(number(value))}%`
    case 'frac':
      return `${trimmed(number(value) * 100)}%`
    case 'int?':
    case 'weight':
      return trimmed(number(value))
    case 'bool':
      return value === true ? '✓' : '—'
    case 'date?':
      return typeof value === 'string' ? formatLongDate(value) : String(value)
    case 'choice':
      return CHOICE_WORDS[field]?.[String(value)] ?? String(value)
    case 'programs':
      return Array.isArray(value)
        ? value.map((k) => names.programs[String(k)] ?? labelOf([String(k)])).join(', ')
        : String(value)
  }
}

/** A row's value, and "was ‹old›" where the draft changed it against the version in effect. */
export function rowWords(
  item: CardRow | ReadOnlyItem,
  content: Record<string, unknown>,
  approved: Record<string, unknown> | null,
  names: RulesNames
): { text: string; was: string | null } {
  const nullWord = 'nullWord' in item ? item.nullWord : undefined
  const now = valueAt(content, item.path)
  const text = settingText(now, item.type, item.path, names, nullWord)
  if (approved === null) return { text, was: null }
  const before = settingText(valueAt(approved, item.path), item.type, item.path, names, nullWord)
  return { text, was: before === text ? null : before }
}

/** "Taken off per dependent"'s tail: ": not used now" unless Dependents lowers the income. */
export function dependentsNote(content: Record<string, unknown>): string {
  return content['dependents_mode'] === 'income_reduction'
    ? '.'
    : ', only while Dependents is "Lower the income": not used now.'
}

// ── The cards' tables (spec §6.2 E): each row as its table shows it ──

const recordOf = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const textOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const sessionWords = (id: unknown, names: RulesNames) =>
  names.sessions?.get(Number(id)) ?? `Session ${String(id)}`

export interface EquityRow {
  readonly index: number
  readonly key: string
  readonly label: string
  readonly enabled: boolean
  /** "was checked" / "was unchecked" where the draft flipped the box; else null. */
  readonly was: string | null
  readonly weights: Readonly<Record<string, unknown>>
  readonly countsWhen: { readonly words: string; readonly chips: readonly string[] }
  readonly reads: string
  readonly dependents: boolean
}

/** The equity classes, as the weights carry them: one weight column each. */
export const equityClasses = (content: Record<string, unknown>): string[] =>
  Object.keys(recordOf(content['weights']))

export function equityRows(
  content: Record<string, unknown>,
  approved: Record<string, unknown> | null
): EquityRow[] {
  const weights = recordOf(content['weights'])
  const before = approved === null ? null : listOf(approved['criteria']).map(recordOf)
  return listOf(content['criteria'])
    .map(recordOf)
    .map((c, index) => {
      const key = textOf(c['key']) ?? String(index)
      const enabled = c['enabled'] !== false
      const prior = before?.find((b) => b['key'] === key)
      const wasEnabled = prior === undefined ? null : prior['enabled'] !== false
      const match = textOf(c['match']) ?? ''
      return {
        index,
        key,
        label: textOf(c['label']) ?? key,
        enabled,
        was:
          wasEnabled === null || wasEnabled === enabled
            ? null
            : wasEnabled
              ? 'was checked'
              : 'was unchecked',
        weights: Object.fromEntries(
          Object.entries(weights).map(([cls, row]) => [cls, recordOf(row)[key]])
        ),
        countsWhen:
          match === 'at_least'
            ? { words: `at least ${String(Number(c['min_value']))}`, chips: [] }
            : {
                words: CHOICE_WORDS['match']?.[match] ?? match,
                chips: listOf(c['values']).map(String),
              },
        reads: [c['field'], ...listOf(c['also_fields'])]
          .flatMap((f) => (typeof f === 'string' && f !== '' ? [f.replaceAll('_', ' ')] : []))
          .join(' + '),
        // calculator/tiers.py is_dependents_criterion: a household criterion reading the dependents count.
        dependents: c['field'] === 'dependents',
      }
    })
}

/**
 * The words under a named award's name (spec §6.2 E.4). DecisionType carries no note, and a real award's or funder's
 * name may not live in code (Global Constraints), so the note comes from the kind, in generic words. Outside grants
 * come off too (owner 10-06); the fund itself is managed in Grants › Grantors, so this row only reads.
 */
export function namedAwardNote(kind: string): string | null {
  return kind === 'full_cost_after_aid'
    ? 'Pays the rest after the camp award and outside grants, outside the budget; no extra amount.'
    : null
}

export interface NamedAwardRow {
  readonly key: string
  readonly label: string
  readonly note: string | null
  readonly kind: string
  readonly round: string
  /** Shown (and editable) on a fixed top-up only; null reads "—". */
  readonly amount: string | null
  /** Shown (and editable) on full cost only; null reads "—". */
  readonly extra: string | null
  readonly allowsAppeal: boolean
  readonly counts: boolean
  /** Owner 10-06 (c): a named fund is managed in Grants › Grantors (slice 3); its row only reads and links there. */
  readonly managedInGrants: boolean
}

export function namedAwardRows(
  content: Record<string, unknown>,
  names: RulesNames
): NamedAwardRow[] {
  return Object.entries(recordOf(content['decision_types'])).map(([key, raw]) => {
    const t = recordOf(raw)
    const kind = textOf(t['kind']) ?? ''
    return {
      key,
      label: textOf(t['label']) ?? key,
      note: namedAwardNote(kind),
      kind: CHOICE_WORDS['kind']?.[kind] ?? kind,
      round: String(t['round'] ?? ''),
      amount: kind === 'top_up' ? settingText(t['amount'], 'money', ['amount'], names) : null,
      extra:
        kind === 'full_cost'
          ? settingText(t['extra_amount'], 'money', ['extra_amount'], names)
          : null,
      allowsAppeal: t['allows_appeal'] !== false,
      counts: t['counts_toward_budget'] !== false,
      managedInGrants: kind === 'full_cost_after_aid',
    }
  })
}

/** The report's program issues that get an inline pill (spec §6.2 E.8), by validation code. */
const PROGRAM_PILLS: Readonly<Record<string, string>> = {
  unclassified_program: 'no pool',
  no_equity_class: 'no equity class',
}

export interface ProgramRow {
  readonly key: string
  readonly label: string
  readonly pills: readonly string[]
  readonly sessions: readonly string[]
  readonly equityClass: string
  readonly pool: string
  readonly costFrom: string
  readonly openToAid: boolean
}

export function programRows(
  content: Record<string, unknown>,
  issues: readonly ApiAidValidationIssue[],
  names: RulesNames
): ProgramRow[] {
  return Object.entries(content).map(([key, raw]) => {
    const p = recordOf(raw)
    const cls = textOf(p['equity_class'])
    const pool = textOf(p['budget_pool'])
    const pills = issues.flatMap((issue) => {
      const words = PROGRAM_PILLS[issue.code]
      return words !== undefined && issue.path.startsWith(`programs.${key}.`) ? [words] : []
    })
    return {
      key,
      label: textOf(p['label']) ?? key,
      pills: [...new Set(pills)],
      sessions: listOf(p['session_cm_ids']).map((id) => sessionWords(id, names)),
      equityClass: cls === null ? 'None' : keyWords(cls),
      pool: pool === null ? 'None' : (names.pools[pool] ?? keyWords(pool)),
      costFrom: CHOICE_WORDS['cost_source']?.[textOf(p['cost_source']) ?? ''] ?? '',
      openToAid: p['open_to_aid'] !== false,
    }
  })
}

export interface CheckRow {
  readonly key: string
  readonly label: string
  readonly on: boolean
  readonly severity: string
  readonly above: string
}

export function checkRows(content: Record<string, unknown>, names: RulesNames): CheckRow[] {
  return Object.entries(recordOf(content['checks'])).map(([key, raw]) => {
    const c = recordOf(raw)
    return {
      key,
      // The same words the Requests grid gives a check's pill.
      label: codeWords(key),
      on: c['enabled'] !== false,
      severity: CHOICE_WORDS['severity']?.[textOf(c['severity']) ?? 'hold'] ?? '',
      above: settingText(c['threshold'], 'money?', ['threshold'], names),
    }
  })
}

export interface CostRows {
  readonly tuition: ReadonlyArray<{
    readonly id: string
    readonly session: string
    readonly tuition: string
  }>
  readonly rates: ReadonlyArray<{
    readonly index: number
    readonly session: string
    readonly standard: string
    readonly infant: string
  }>
}

export function costRows(content: Record<string, unknown>, names: RulesNames): CostRows {
  return {
    tuition: Object.entries(recordOf(content['tuition'])).map(([id, value]) => ({
      id,
      session: sessionWords(id, names),
      tuition: settingText(value, 'money', ['tuition', id], names),
    })),
    rates: listOf(content['family_rates'])
      .map(recordOf)
      .map((r, index) => ({
        index,
        session: sessionWords(r['session_cm_id'], names),
        standard: settingText(r['standard'], 'money', ['standard'], names),
        infant: settingText(r['infant'], 'money', ['infant'], names),
      })),
  }
}
