/**
 * Season › Rules' words and layout (spec §7.5; D39, D76; rules.html A, season-access.html C). Pure.
 * The rules document is shown section by section, each as the server sends it (`content`, the
 * section's JSON): this module only names each setting and lays nested settings out as lines,
 * groups and small tables. It never computes a setting, and never reads one the way the engine
 * does: a label says what the field is (bunking/financial_aid/rules/schema.py), nothing more.
 */
import type {
  ApiAidFieldChange,
  ApiAidRulesSection,
  ApiAidSectionStatus,
  ApiAidValidationIssue,
} from '../../../../types/api-types'
import type { PillTone } from '../../kit/kitStyles'
import { formatLongDate } from '../../kit/dates'
import { formatMoney } from '../../kit/money'

// ── Sections ──────────────────────────────────────────────────────────────────

/**
 * Money settings first, then the season's description (§7.5; rules.html A). `grants` sits with the
 * money: its offset mode is a sizing lever (D137), though the mock drew it with the season's
 * description (slice 2 plan, Decision 13).
 */
export const MONEY_SECTIONS: readonly ApiAidRulesSection[] = [
  'income',
  'tiers',
  'equity',
  'award_tables',
  'awards',
  'grants',
  'round2',
  'round3',
  'budget',
]
export const SEASON_SECTIONS: readonly ApiAidRulesSection[] = [
  'programs',
  'cost',
  'stages',
  'quality_checks',
  'milestones',
]

export const SECTION_TITLES = {
  income: 'Income',
  tiers: 'Income bands',
  equity: 'Equity',
  award_tables: 'Award tables (Round 1 %)',
  awards: 'Minimum award and limits',
  grants: 'Outside grants',
  round2: 'Round 2 caps',
  round3: 'Round 3',
  budget: 'Budget and reserves',
  programs: 'Programs and session mapping',
  cost: 'Costs and Family Camp rates',
  stages: 'Stages',
  quality_checks: 'Quality checks',
  milestones: 'Milestones and dates',
} as const satisfies Record<ApiAidRulesSection, string>

export function isRulesSection(value: string | null): value is ApiAidRulesSection {
  return value !== null && Object.hasOwn(SECTION_TITLES, value)
}

// ── A section's status (D39: approved / draft · n changes, and who) ───────────

export interface StatusWords {
  readonly pill: string
  readonly tone: PillTone
  /** Who and when, and the note naming the approving body (D39). */
  readonly meta: string
}

const when = (iso: string | null | undefined) => (iso ? formatLongDate(iso) : null)
const joined = (parts: ReadonlyArray<string | null | undefined>) =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' · ')

/**
 * The pill and the line beside a section: "Approved" / "Locked" / "Draft · 3 changes", and
 * "Mar 9, 2027 · finance@… · Finance, Jan 20 meeting" (the note names the approving body, D39).
 * `changes` is null on the approved read, which has no draft to compare.
 */
export function statusWords(status: ApiAidSectionStatus, changes: number | null): StatusWords {
  const state = status.state ?? 'draft'
  if (state === 'locked') {
    return {
      pill: 'Locked',
      tone: 'stone',
      meta: joined([
        `in use since ${when(status.locked_at) ?? 'its first lock'}`,
        status.approved_by,
        status.note,
      ]),
    }
  }
  if (state === 'approved') {
    return {
      pill: 'Approved',
      tone: 'emerald',
      meta: joined([when(status.approved_at), status.approved_by, status.note]),
    }
  }
  const counted =
    changes === null || changes === 0
      ? 'Draft'
      : `Draft · ${String(changes)} ${changes === 1 ? 'change' : 'changes'}`
  return {
    pill: counted,
    tone: 'amber',
    meta: joined([
      when(status.edited_at),
      status.edited_by,
      status.edited_via ? `from ${status.edited_via}` : null,
    ]),
  }
}

/** "2 errors · 1 warning", or null when the section validates clean. */
export function issueWords(errors: number, warnings: number): string | null {
  const parts: string[] = []
  if (errors > 0) parts.push(`${String(errors)} ${errors === 1 ? 'error' : 'errors'}`)
  if (warnings > 0) parts.push(`${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`)
  return parts.length === 0 ? null : parts.join(' · ')
}

/** The validation report's issues for one section, errors first (§7.5: they show on the section). */
export function sectionIssues(
  issues: readonly ApiAidValidationIssue[] | undefined,
  section: ApiAidRulesSection
): ApiAidValidationIssue[] {
  return (issues ?? [])
    .filter((issue) => issue.section === section)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
}

// ── Settings: names and how each figure reads ────────────────────────────────

/** Each field's name, from the schema (rules/schema.py). An unknown field reads as its own words. */
const LABELS: Readonly<Record<string, string>> = {
  weights: 'Weights',
  prior_year: 'Prior-year weight',
  current_year: 'Current-year weight',
  basis: 'Prior-year income measure',
  current_year_zero_fallback: 'When current-year income is $0',
  medical_threshold: 'Medical expenses counted above',
  medical_rate: 'Medical deduction rate',
  education_threshold: 'Education expenses counted above',
  education_rate: 'Education deduction rate',
  savings_threshold: 'Savings counted above',
  savings_inclusion_rate: 'Savings inclusion rate',
  extra_terms: 'Extra income terms',
  figure: 'Figure',
  direction: 'Direction',
  threshold: 'Threshold',
  rate: 'Rate',
  dependents_mode: 'Dependents',
  per_dependent_reduction: 'Reduction per dependent',
  floor: 'Income floor',
  floor_applies_after: 'Floor tested after',
  bands: 'Income bands',
  lower: 'From',
  upper: 'To',
  income_ceiling: 'Income ceiling',
  floor_tier: 'Floor tier',
  criteria: 'Criteria',
  key: 'Key',
  label: 'Label',
  source: 'Whose answer',
  field: 'Field',
  also_fields: 'Also these fields',
  match: 'Match',
  values: 'Values',
  min_value: 'At least',
  aggregation: 'Shift rounding',
  max_shift: 'Largest shift',
  inherits: 'Inherits',
  tiers: 'Tiers',
  overrides: 'Overrides',
  r1_pct: 'Round 1 %',
  session_cm_ids: 'CampMinder sessions',
  session_types: 'Session types',
  r1_table: 'Round 1 table',
  equity_class: 'Equity class',
  budget_pool: 'Budget pool',
  cost_source: 'Cost from',
  open_to_aid: 'Open to aid',
  tuition: 'Tuition by session',
  family_rates: 'Family Camp rates',
  session_cm_id: 'Session',
  standard: 'Standard',
  infant: 'Infant',
  child: 'Child',
  infant_age_cutoff_months: 'Infant under (months)',
  override_reasons: 'Cost override reasons',
  offset_programs: 'Programs grants offset',
  offset_mode: 'Offset mode',
  minimum_after_grants: 'Minimum paid on top of a partial grant',
  minimum_when_fully_covered: 'Minimum paid when grants cover the cost',
  minimum_capped_at_share: 'Minimum capped at what grants leave of the cost',
  count_when: 'Grants count when',
  late_grant_policy: 'A grant recorded after Round 1',
  incentives: 'Incentives',
  mode: 'Mode',
  minimum: 'Minimum award',
  minimum_when_cost_unknown: 'Minimum when the cost is unknown',
  minimum_without_table: 'Minimum with no award table',
  rounding: 'Rounding',
  ask_cap: 'The ask caps the award',
  decision_types: 'Decision types',
  kind: 'Kind',
  round: 'Round',
  amount: 'Amount',
  extra_amount: 'Extra amount',
  allows_appeal: 'Allows an appeal',
  budget_line: 'Budget line',
  counts_toward_budget: 'Counts toward the budget',
  ceiling_exempt: 'Pays above the income ceiling',
  cap_subtracts_grants: 'The appeal cap subtracts grants',
  cap_by_original_ask: 'Capped by the original ask',
  total_pct: 'Total %',
  program_tables: 'Round 2 table by program',
  total_cap: 'Total-aid cap',
  pct_of_cost: '% of cost',
  include_grants: 'Includes grants',
  require_round2: 'Needs a Round 2 decision',
  require_statement_of_need: 'Needs a statement of need',
  max_amount: 'Most per request',
  max_total_pct_of_cost: 'Most, as % of cost',
  registrar_limit: "The registrar's limit",
  total: 'Total budget',
  pools: 'Pools',
  share_pct: 'Share %',
  reserves: 'Reserves (% of the pool)',
  r1_late: 'Late Round 1',
  r2: 'Round 2',
  r3: 'Round 3',
  spillover: 'Spillover between pools',
  commit_on: 'Counts as committed when',
  stages: 'Stages',
  code: 'Code',
  is_offer: 'Offer',
  is_accepted: 'Accepted',
  is_cancel: 'Cancel',
  include_default: 'Included by default',
  decision_type: 'Decision type',
  checks: 'Checks',
  enabled: 'On',
  severity: 'Severity',
  application_deadline: 'Application deadline',
  r1_run: 'Round 1 run',
  response_deadline: 'Response deadline',
  r2_window_start: 'Round 2 opens',
  r2_window_end: 'Round 2 closes',
  r3_window_start: 'Round 3 opens',
  r3_window_end: 'Round 3 closes',
}

const MONEY_KEYS: ReadonlySet<string> = new Set([
  'medical_threshold',
  'education_threshold',
  'savings_threshold',
  'per_dependent_reduction',
  'floor',
  'lower',
  'upper',
  'income_ceiling',
  'standard',
  'infant',
  'child',
  'minimum',
  'amount',
  'extra_amount',
  'total',
  'max_amount',
  'registrar_limit',
])
/** Percentage points (rules/schema.py: "42.5 means 42.5%"). */
const PERCENT_KEYS: ReadonlySet<string> = new Set([
  'r1_pct',
  'total_pct',
  'pct_of_cost',
  'max_total_pct_of_cost',
  'share_pct',
])
const DATE_KEYS: ReadonlySet<string> = new Set([
  'application_deadline',
  'r1_run',
  'response_deadline',
  'r2_window_start',
  'r2_window_end',
  'r3_window_start',
  'r3_window_end',
])

export type SettingUnit = 'money' | 'percent' | 'date' | 'plain'

/**
 * How a setting's figure reads, by its field and where it sits: tuition by session is money,
 * a pool's reserves are percentage points, an income term's threshold is money while a quality
 * check's threshold is a plain figure (rules/schema.py).
 */
export function unitOf(path: readonly string[]): SettingUnit {
  const last = path.at(-1) ?? ''
  if (path[0] === 'tuition' && path.length === 2) return 'money'
  if (path[0] === 'reserves' && path.length === 3) return 'percent'
  if (last === 'threshold') return path[0] === 'extra_terms' ? 'money' : 'plain'
  if (MONEY_KEYS.has(last)) return 'money'
  if (PERCENT_KEYS.has(last)) return 'percent'
  if (DATE_KEYS.has(last)) return 'date'
  return 'plain'
}

const words = (value: string) => value.replaceAll('_', ' ')

/** A field's name; a numbered key reads as a tier, or a session under tuition. */
export function labelOf(path: readonly string[]): string {
  const key = path.at(-1) ?? ''
  const parent = path.at(-2)
  if (/^\d+$/.test(key)) {
    if (parent === 'tiers' || parent === 'overrides') return `Tier ${key}`
    if (parent === 'tuition') return `Session ${key}`
    return key
  }
  const label = LABELS[key] ?? words(key)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export type Scalar = string | number | boolean | null

export function isScalar(value: unknown): value is Scalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One figure as staff read it: "$26,000", "74.5%", "Mar 1, 2027", "yes", "income reduction", "—". */
export function formatSetting(value: unknown, path: readonly string[]): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((item) => formatSetting(item, path)).join(', ')
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const unit = unitOf(path)
    const n = Number(value)
    if (unit === 'money' && value !== '' && Number.isFinite(n)) return formatMoney(n)
    if (unit === 'percent' && value !== '' && Number.isFinite(n)) return `${String(value)}%`
    if (unit === 'date' && typeof value === 'string') return formatLongDate(value)
    return typeof value === 'string' ? words(value) : String(value)
  }
  return JSON.stringify(value)
}

// ── Laying a section out ──────────────────────────────────────────────────────

export interface SettingColumn {
  readonly key: string
  readonly label: string
}

export interface SettingRow {
  /** The key in the section's JSON: a name, a tier, or a list's index from 0. */
  readonly key: string
  readonly label: string
  /** Each cell's raw value, by column key: the editor (PR 4) types into these. */
  readonly cells: Readonly<Record<string, unknown>>
}

export type SettingNode =
  | {
      readonly kind: 'leaf'
      readonly path: readonly string[]
      readonly label: string
      readonly value: unknown
    }
  | {
      readonly kind: 'group'
      readonly path: readonly string[]
      readonly label: string
      readonly children: readonly SettingNode[]
    }
  | {
      readonly kind: 'table'
      readonly path: readonly string[]
      readonly label: string
      readonly columns: readonly SettingColumn[]
      readonly rows: readonly SettingRow[]
    }

/** A value that fills one cell: a scalar, or a list of scalars. */
function isCellValue(value: unknown): boolean {
  return isScalar(value) || (Array.isArray(value) && value.every(isScalar))
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.values(value).every(isCellValue)
}

function tableOf(
  path: readonly string[],
  entries: ReadonlyArray<{ key: string; label: string; cells: Record<string, unknown> }>
): SettingNode {
  const keys: string[] = []
  for (const entry of entries)
    for (const key of Object.keys(entry.cells)) if (!keys.includes(key)) keys.push(key)
  return {
    kind: 'table',
    path,
    label: labelOf(path),
    columns: keys.map((key) => ({ key, label: labelOf([...path, '*', key]) })),
    rows: entries,
  }
}

function nodeOf(path: readonly string[], value: unknown): SettingNode {
  if (isCellValue(value)) return { kind: 'leaf', path, label: labelOf(path), value }
  if (Array.isArray(value) && value.every(isFlatObject)) {
    // A list's row key is its index (the editor writes back to it); staff count from 1.
    return tableOf(
      path,
      value.map((cells, index) => ({ key: String(index), label: String(index + 1), cells }))
    )
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    // An empty set of settings (no weights, no incentives yet) reads as "none".
    if (entries.length === 0) return { kind: 'leaf', path, label: labelOf(path), value: [] }
    if (entries.every(([, v]) => isFlatObject(v))) {
      return tableOf(
        path,
        (entries as Array<[string, Record<string, unknown>]>).map(([key, cells]) => ({
          key,
          label: /^\d+$/.test(key) ? labelOf([...path, key]) : key,
          cells,
        }))
      )
    }
    return {
      kind: 'group',
      path,
      label: labelOf(path),
      children: entries.map(([key, child]) => nodeOf([...path, key], child)),
    }
  }
  return { kind: 'leaf', path, label: labelOf(path), value: JSON.stringify(value) }
}

/**
 * A section's content laid out: each setting a line; a nested set of settings a group; a list of
 * like records (income bands, criteria, stages) or a set of them keyed by name or tier (pools,
 * programs, a table's tiers, quality checks) a small table. Paths are inside the section, as the
 * server's changes are (`DraftSectionOut.changes`).
 */
export function settingNodes(content: Readonly<Record<string, unknown>>): SettingNode[] {
  return Object.entries(content).map(([key, value]) => nodeOf([key], value))
}

// ── What a draft changed (D39: "Draft · n changes") ───────────────────────────

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  prefix.every((part, index) => path[index] === part)

/** Whether a setting (or a cell, or a whole table) is one the draft changed. */
export function isChanged(path: readonly string[], changes: readonly ApiAidFieldChange[]): boolean {
  return changes.some((change) => startsWith(path, change.path) || startsWith(change.path, path))
}

/** "General › Tiers › Tier 2 › Round 1 %: 60% → 55%"; a whole list or set of settings "changed". */
export function changeWords(change: ApiAidFieldChange): string {
  const names = change.path.map((_, index) => labelOf(change.path.slice(0, index + 1)))
  const where = names.join(' › ')
  const show = (value: unknown) => formatSetting(value, change.path)
  if (change.kind === 'added') {
    return isCellValue(change.after) ? `${where}: added, ${show(change.after)}` : `${where}: added`
  }
  if (change.kind === 'removed') {
    return isCellValue(change.before)
      ? `${where}: removed (was ${show(change.before)})`
      : `${where}: removed`
  }
  if (!isCellValue(change.before) || !isCellValue(change.after)) return `${where}: changed`
  return `${where}: ${show(change.before)} → ${show(change.after)}`
}
