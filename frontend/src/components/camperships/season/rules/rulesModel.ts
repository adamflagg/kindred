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
import { campToday, formatLongDate } from '../../kit/dates'
import { formatMoney } from '../../kit/money'
import { codeWords } from '../../requests/attention'

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
  'quality_checks',
  'milestones',
]

export const SECTION_TITLES = {
  income: "Counting a family's income",
  tiers: 'Income tiers',
  equity: 'Moving a family up a tier',
  award_tables: 'Round 1 award table',
  awards: 'Minimum award and named awards',
  grants: 'Outside grants',
  round2: 'Appeal caps',
  round3: 'Who can ask, and how much',
  budget: 'Budget and pools',
  programs: 'Programs and their sessions',
  cost: 'Costs and Family Camp rates',
  quality_checks: 'Quality checks',
  milestones: 'Dates',
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
  /** The approving body's note (Finance, Jan 20 meeting): the card says "Approved by ‹note›" beside the meta. */
  readonly note: string | null
}

/** A stored timestamp as its camp-time day: 8pm Pacific on Jan 20 is stored as Jan 21 in UTC. */
const when = (iso: string | null | undefined) => {
  if (!iso) return null
  const at = new Date(iso)
  return formatLongDate(Number.isNaN(at.getTime()) ? iso : campToday(at))
}
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
      ]),
      note: status.note ?? null,
    }
  }
  if (state === 'approved') {
    return {
      pill: 'In effect',
      tone: 'emerald',
      meta: joined([when(status.approved_at), status.approved_by]),
      note: status.note ?? null,
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
    note: null,
  }
}

/**
 * A version's lead line (#23): "Rules v4 · approved Oct 5, 2026", the day its last section was
 * approved; a version with sections still in draft says how many. A locked section was approved
 * first, so it counts as approved.
 */
export function versionWords(
  version: number,
  statuses: ReadonlyArray<Pick<ApiAidSectionStatus, 'state' | 'approved_at'>>
): string {
  const name = `Rules v${String(version)}`
  const drafts = statuses.filter((status) => (status.state ?? 'draft') === 'draft').length
  if (drafts > 0) {
    return `${name} · draft: ${String(drafts)} ${drafts === 1 ? 'section' : 'sections'} not approved yet`
  }
  const last = statuses
    .map((status) => status.approved_at ?? '')
    .filter((at) => at !== '')
    .sort()
    .at(-1)
  return last === undefined ? `${name} · approved` : `${name} · approved ${when(last) ?? last}`
}

/**
 * A note (#3049: "the minimum decides" on a Round 1 cell) is information: neither a warning nor an error. No count,
 * chip or list of warnings holds one; it shows on its cell (B3).
 */
export const isNote = (issue: { readonly severity?: string }): boolean => issue.severity === 'note'

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
  prior_year: 'Prior-year weight (0 to 1)',
  current_year: 'Current-year weight (0 to 1)',
  basis: 'Prior-year income measure',
  current_year_zero_fallback: 'When current-year income is $0',
  medical_threshold: 'Medical expenses counted above',
  medical_rate: 'Medical deduction rate (0 to 1)',
  education_threshold: 'Education expenses counted above',
  education_rate: 'Education deduction rate (0 to 1)',
  savings_threshold: 'Savings counted above',
  savings_inclusion_rate: 'Savings inclusion rate (0 to 1)',
  extra_terms: 'Extra income terms',
  figure: 'Figure',
  direction: 'Direction',
  threshold: 'Threshold',
  rate: 'Rate (0 to 1)',
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
  infant_age_cutoff_months: 'Infant under (months)',
  override_reasons: 'Cost override reasons',
  offset_programs: 'Programs grants offset',
  offset_mode: 'Offset mode',
  minimum_after_grants: 'Minimum paid on top of a partial grant',
  minimum_when_fully_covered: 'Minimum paid when grants cover the cost',
  minimum_capped_at_share: 'Minimum capped at what grants leave of the cost',
  count_when: 'Grants count when',
  late_grant_policy: 'A grant recorded after Round 1',
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
  counts_toward_budget: 'Counts toward the budget',
  ceiling_exempt: 'Pays above the income ceiling',
  cap_subtracts_grants: 'The appeal cap subtracts grants',
  cap_by_original_ask: 'Capped by the original ask',
  total_pct: 'Total %',
  campminder_description: 'CampMinder description',
  tables: 'Round 2 tables',
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
  if (last === 'threshold') {
    // Income terms and three of the four quality checks compare dollars; only the dependents
    // check compares a count (calculator/quality.py).
    return path.at(-2) === 'implausible_dependents' ? 'plain' : 'money'
  }
  if (MONEY_KEYS.has(last)) return 'money'
  if (PERCENT_KEYS.has(last)) return 'percent'
  if (DATE_KEYS.has(last)) return 'date'
  return 'plain'
}

// ── Names: the rules' own keys in the document's words (#15) ─────────────────

/**
 * What the screen knows to name the rules' keys by: each pool's, program's, decision type's and
 * equity criterion's label as the rules document carries it, and the season's session names when
 * the screen has them. Staff never read a key or a CampMinder id where a name exists; a table or
 * equity class with no label borrows its same-key program's or pool's (`keyLabel`), any other key
 * with no label reads in words (`keyWords`), and a session with no name as "Session 9300101".
 */
export interface RulesVocabulary {
  readonly pools: Readonly<Record<string, string>>
  readonly programs: Readonly<Record<string, string>>
  readonly decisionTypes: Readonly<Record<string, string>>
  readonly criteria: Readonly<Record<string, string>>
  readonly sessions?: ReadonlyMap<number, string> | undefined
}

/** The vocabulary, with the section the paths sit in: a key's meaning depends on its section. */
export interface RulesNames extends RulesVocabulary {
  readonly section: ApiAidRulesSection
}

const recordOf = (value: unknown): Record<string, unknown> => (isPlainObject(value) ? value : {})

/** Each entry's `label`, by its key ({pool_a: {label: 'Pool A'}} → {pool_a: 'Pool A'}). */
function labelsOf(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const [key, entry] of Object.entries(recordOf(value))) {
    const label = recordOf(entry)['label']
    if (typeof label === 'string' && label !== '') labels[key] = label
  }
  return labels
}

/**
 * The vocabulary from a rules document, read section by section (the approved read sends each
 * section on its own, and an unapproved one as null): pools from the budget, programs, decision
 * types from the awards, criteria from equity.
 */
export function rulesVocabulary(
  sectionOf: (section: ApiAidRulesSection) => unknown,
  sessions?: ReadonlyMap<number, string>
): RulesVocabulary {
  const criteria: Record<string, string> = {}
  const listed = recordOf(sectionOf('equity'))['criteria']
  for (const criterion of Array.isArray(listed) ? listed : []) {
    const { key, label } = recordOf(criterion)
    if (typeof key === 'string' && typeof label === 'string' && label !== '') criteria[key] = label
  }
  return {
    pools: labelsOf(recordOf(sectionOf('budget'))['pools']),
    programs: labelsOf(sectionOf('programs')),
    decisionTypes: labelsOf(recordOf(sectionOf('awards'))['decision_types']),
    criteria,
    sessions,
  }
}

/**
 * Words for a key the rules carry no label for: acronyms staff write in capitals, and one equity
 * criterion's sheet-era key.
 */
const KEY_WORDS: Readonly<Record<string, string>> = {
  agi: 'AGI',
  bipoc: 'BIPOC',
  trans_nb: 'Trans / nonbinary',
}

/** A key with no label: its word, else its own words in sentence case ("camp_quest" → "Camp quest"). */
export function keyWords(key: string): string {
  const known = own(KEY_WORDS, key)
  if (known !== undefined) return known
  const plain = words(key)
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

/** A key the rules give no label: the program's label with that key, else the pool's, else its words (owner 10-07). */
export function keyLabel(key: string, names: Pick<RulesVocabulary, 'programs' | 'pools'>): string {
  return own(names.programs, key) ?? own(names.pools, key) ?? keyWords(key)
}

/** A map's own entry only: a key like "constructor" must not read an inherited Object property. */
function own(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

type KeyKind =
  | 'pool'
  | 'program'
  | 'decision_type'
  | 'check'
  | 'table'
  | 'equity_class'
  | 'criterion'
  | 'session'
  | 'severity'
  | 'basis'

/** What a key names, by where it sits in its section; null for a field's own name. */
function keyKind(section: ApiAidRulesSection, path: readonly string[]): KeyKind | null {
  const [first, second] = path
  if (path.length === 1) {
    if (section === 'programs') return 'program'
    if (section === 'award_tables') return 'table'
    return null
  }
  if (path.length === 2) {
    if (section === 'budget' && first === 'pools') return 'pool'
    if (section === 'awards' && first === 'decision_types') return 'decision_type'
    if (section === 'quality_checks' && first === 'checks') return 'check'
    if (section === 'round2' && first === 'tables') return 'table'
    if (section === 'round2' && first === 'program_tables') return 'program'
    if (section === 'equity' && first === 'weights') return 'equity_class'
    if (section === 'cost' && first === 'tuition') return 'session'
    return null
  }
  // An equity class's weight per criterion (the table's columns sit at ['weights', '*', key]).
  if (path.length === 3 && section === 'equity' && first === 'weights' && second !== undefined) {
    return 'criterion'
  }
  return null
}

/** What a value names, by its field and section: a program's pool, a family rate's session, … */
function valueKind(section: ApiAidRulesSection, path: readonly string[]): KeyKind | null {
  // A list's element (a diff line carries one) reads as its list does.
  const at = /^\d+$/.test(path.at(-1) ?? '') && path.length > 1 ? path.slice(0, -1) : path
  const field = at.at(-1)
  if (section === 'programs' && at.length === 2) {
    if (field === 'session_cm_ids') return 'session'
    if (field === 'budget_pool') return 'pool'
    if (field === 'r1_table') return 'table'
    if (field === 'equity_class') return 'equity_class'
  }
  if (section === 'round2' && at.length === 2 && at[0] === 'program_tables') return 'table'
  // A table that inherits names the table it inherits.
  if ((section === 'award_tables' || section === 'round2') && field === 'inherits') return 'table'
  if (section === 'cost' && field === 'session_cm_id') return 'session'
  if (section === 'quality_checks' && field === 'severity') return 'severity'
  if (section === 'grants' && at.length === 1 && field === 'offset_programs') return 'program'
  if (section === 'income' && at.length === 1 && field === 'basis') return 'basis'
  return null
}

const SEVERITY_WORDS: Readonly<Record<string, string>> = { warn: 'Warning', hold: 'Hold' }

/** A key (or a value that is one) in its name: a label from the rules, else words. */
function nameOf(kind: KeyKind, key: string, names: RulesVocabulary): string {
  switch (kind) {
    case 'pool':
      return names.pools[key] ?? keyWords(key)
    case 'program':
      return names.programs[key] ?? keyWords(key)
    case 'decision_type':
      return names.decisionTypes[key] ?? keyWords(key)
    case 'criterion':
      return names.criteria[key] ?? keyWords(key)
    case 'check':
      // The same words the Requests grid gives a check's pill.
      return codeWords(key)
    case 'session':
      return names.sessions?.get(Number(key)) ?? `Session ${key}`
    case 'severity':
      return SEVERITY_WORDS[key] ?? keyWords(key)
    case 'basis':
      // An income measure is a choice, read in lower case like the others ("gross"); AGI is an acronym.
      return KEY_WORDS[key] ?? words(key)
    case 'table':
    case 'equity_class':
      return keyLabel(key, names)
  }
}

const LIST_PARENTS: ReadonlySet<string> = new Set([
  'bands',
  'extra_terms',
  'criteria',
  'family_rates',
])

const words = (value: string) => value.replaceAll('_', ' ')

/**
 * Staff never read the server's `headcount` code (owner ruling V6, "Number of People"); the other
 * override reasons already read as their own words (rules/schema.py `_default_override_reasons`).
 */
const OVERRIDE_REASON_WORDS: Readonly<Record<string, string>> = { headcount: 'number of people' }

/** The list itself, or one of its elements. */
const isOverrideReason = (path: readonly string[]) =>
  path.at(-1) === 'override_reasons' ||
  (/^\d+$/.test(path.at(-1) ?? '') && path.at(-2) === 'override_reasons')

/**
 * A field's name; a numbered key reads as a tier, or a session under tuition. With `names`, a key
 * the rules define (a pool, a program, a decision type, a check, a session, …) reads as its name.
 */
export function labelOf(path: readonly string[], names?: RulesNames): string {
  const key = path.at(-1) ?? ''
  const parent = path.at(-2)
  const kind = names === undefined ? null : keyKind(names.section, path)
  if (kind !== null && names !== undefined) return nameOf(kind, key, names)
  if (/^\d+$/.test(key)) {
    if (parent === 'tiers' || parent === 'overrides') return `Tier ${key}`
    if (parent === 'tuition') return `Session ${key}`
    // A list entry counts from 1, as a table row does.
    if (parent !== undefined && LIST_PARENTS.has(parent)) return String(Number(key) + 1)
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

/**
 * One figure as staff read it: "$26,000", "74.5%", "Mar 1, 2027", "yes", "income reduction", "—".
 * With `names`, a value that is one of the rules' keys (a program's pool, a family rate's session)
 * reads as its name. Only the words change: an editor's box keeps and sends the key.
 */
export function formatSetting(value: unknown, path: readonly string[], names?: RulesNames): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) {
    return value.length === 0
      ? 'none'
      : value.map((item) => formatSetting(item, path, names)).join(', ')
  }
  const kind = names === undefined ? null : valueKind(names.section, path)
  if (
    kind !== null &&
    names !== undefined &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    return nameOf(kind, String(value), names)
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const unit = unitOf(path)
    const n = Number(value)
    if (unit === 'money' && value !== '' && Number.isFinite(n)) return formatMoney(n)
    if (unit === 'percent' && value !== '' && Number.isFinite(n)) return `${String(value)}%`
    if (unit === 'date' && typeof value === 'string') return formatLongDate(value)
    if (typeof value === 'string' && isOverrideReason(path)) {
      return OVERRIDE_REASON_WORDS[value] ?? words(value)
    }
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
  entries: ReadonlyArray<{ key: string; label: string; cells: Record<string, unknown> }>,
  names: RulesNames | undefined
): SettingNode {
  const keys: string[] = []
  for (const entry of entries)
    for (const key of Object.keys(entry.cells)) if (!keys.includes(key)) keys.push(key)
  return {
    kind: 'table',
    path,
    label: labelOf(path, names),
    columns: keys.map((key) => ({ key, label: labelOf([...path, '*', key], names) })),
    rows: entries,
  }
}

function nodeOf(
  path: readonly string[],
  value: unknown,
  names: RulesNames | undefined
): SettingNode {
  const label = labelOf(path, names)
  if (isCellValue(value)) return { kind: 'leaf', path, label, value }
  if (Array.isArray(value) && value.every(isFlatObject)) {
    // A list's row key is its index (the editor writes back to it); staff count from 1.
    return tableOf(
      path,
      value.map((cells, index) => ({ key: String(index), label: String(index + 1), cells })),
      names
    )
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    // An empty set of settings (no weights yet) reads as "none".
    if (entries.length === 0) return { kind: 'leaf', path, label, value: [] }
    if (entries.every(([, v]) => isFlatObject(v))) {
      // A row keeps its key (the editor writes back to it); it reads as the key's name.
      return tableOf(
        path,
        (entries as Array<[string, Record<string, unknown>]>).map(([key, cells]) => ({
          key,
          label: /^\d+$/.test(key) || names !== undefined ? labelOf([...path, key], names) : key,
          cells,
        })),
        names
      )
    }
    return {
      kind: 'group',
      path,
      label,
      children: entries.map(([key, child]) => nodeOf([...path, key], child, names)),
    }
  }
  return { kind: 'leaf', path, label, value: JSON.stringify(value) }
}

/**
 * A section's content laid out: each setting a line; a nested set of settings a group; a list of
 * like records (income bands, criteria) or a set of them keyed by name or tier (pools,
 * programs, a table's tiers, quality checks) a small table. Paths are inside the section, as the
 * server's changes are (`DraftSectionOut.changes`).
 */
export function settingNodes(
  content: Readonly<Record<string, unknown>>,
  names?: RulesNames
): SettingNode[] {
  return Object.entries(content).map(([key, value]) => nodeOf([key], value, names))
}

// ── What a draft changed (D39: "Draft · n changes") ───────────────────────────

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  prefix.every((part, index) => path[index] === part)

/** Whether a setting (or a cell, or a whole table) is one the draft changed. */
export function isChanged(path: readonly string[], changes: readonly ApiAidFieldChange[]): boolean {
  return changes.some((change) => startsWith(path, change.path) || startsWith(change.path, path))
}

/**
 * "General › Tiers › Tier 2 › Round 1 %: 60% → 55%"; a whole list or set of settings "changed". `format` words each
 * figure: formatSetting unless a screen words its own (Scenarios shows whole dollars).
 */
export function changeWords(
  change: ApiAidFieldChange,
  names?: RulesNames,
  format: typeof formatSetting = formatSetting
): string {
  const where = change.path
    .map((_, index) => labelOf(change.path.slice(0, index + 1), names))
    .join(' › ')
  const show = (value: unknown) => format(value, change.path, names)
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
