/**
 * Editing one rules section in place (spec §7.5; D39: one editor per section; slice 2 Decisions
 * 14–16). Pure. What can be typed: every number, yes/no and choice the section already holds, and the
 * settings the schema lets be empty (an income ceiling, a Round 3 limit). Names, keys, references,
 * dates and lists stay as they are: adding a band, a program or a table is the season-description
 * forms', which come later (D39's build order). The server validates the whole section on save.
 *
 * Settings are told apart by where they sit, never by their key alone: an equity weight is named
 * for a criterion the season chose ("child", "upper"), and must not read as the field it spells.
 */
import type {
  ApiAidFieldChange,
  ApiAidProgramProfile,
  ApiAidRulesDocument,
  ApiAidRulesDraft,
  ApiAidRulesSection,
} from '../../../../types/api-types'
import { keyWords, labelOf, unitOf, type SettingUnit } from './rulesModel'

/** Settings the schema lets be empty (`… | None`), whose box may be cleared (rules/schema.py). */
const NULLABLE: ReadonlySet<string> = new Set([
  'income_ceiling',
  'upper',
  'min_value',
  'max_amount',
  'max_total_pct_of_cost',
  'registrar_limit',
  'max_shift',
  'infant_age_cutoff_months',
])

/** A quality check's threshold may be empty; an income term's may not (it defaults to $0). */
function isNullable(path: readonly string[]): boolean {
  const key = path.at(-1) ?? ''
  return key === 'threshold' ? path[0] === 'checks' : NULLABLE.has(key)
}

/** An equity weight: equity class -> criterion key -> weight. Its last key is the season's own word. */
function isEquityWeight(path: readonly string[]): boolean {
  return path[0] === 'weights' && path.length === 3
}

type Doc = ApiAidRulesDocument
/** Every option of a generated `Literal`, once: `satisfies` fails tsc when the schema gains or drops one. */
type Options<T> = Readonly<Record<Extract<NonNullable<T>, string>, true>>
type Term = NonNullable<Doc['income']['extra_terms']>[number]
type Criterion = NonNullable<Doc['equity']['criteria']>[number]
type Check = NonNullable<NonNullable<Doc['quality_checks']>['checks']>[string]

const options = <T extends string>(set: Readonly<Record<T, true>>): readonly T[] =>
  Object.keys(set) as T[]

/**
 * Each choice's options, read from the generated types (rules/schema.py's `Literal`s), never copied
 * by hand: a regenerated `types.gen.ts` that adds or drops an option fails `tsc` here, on the PR that
 * changed the schema (the slice 1 plan review's I5 lesson, without a Python-reading test).
 */
const CHOICES: Readonly<Record<string, readonly string[]>> = {
  basis: options({ gross: true, agi: true, confirmed: true } satisfies Options<
    Doc['income']['basis']
  >),
  current_year_zero_fallback: options({ blend: true, prior_year_only: true } satisfies Options<
    Doc['income']['current_year_zero_fallback']
  >),
  dependents_mode: options({
    none: true,
    income_reduction: true,
    tier_shift: true,
  } satisfies Options<Doc['income']['dependents_mode']>),
  floor_applies_after: options({ deductions: true, all_reductions: true } satisfies Options<
    Doc['income']['floor_applies_after']
  >),
  figure: options({ total_housing_expenses: true, total_rent: true } satisfies Options<
    Term['figure']
  >),
  direction: options({ deduct: true, add: true } satisfies Options<Term['direction']>),
  source: options({ household: true, camper: true } satisfies Options<Criterion['source']>),
  match: options({ equals_any: true, contains_any: true, at_least: true } satisfies Options<
    Criterion['match']
  >),
  aggregation: options({ ceil: true, round: true, floor: true } satisfies Options<
    Doc['equity']['aggregation']
  >),
  cost_source: options({ catalog: true, per_person: true, typed: true } satisfies Options<
    ApiAidProgramProfile['cost_source']
  >),
  offset_mode: options({ dollar: true, reduce_cost_basis: true } satisfies Options<
    Doc['grants']['offset_mode']
  >),
  count_when: options({ committed: true, received: true } satisfies Options<
    Doc['grants']['count_when']
  >),
  late_grant_policy: options({ ignore: true, flag: true, recalculate: true } satisfies Options<
    Doc['grants']['late_grant_policy']
  >),
  severity: options({ hold: true, warn: true } satisfies Options<Check['severity']>),
}

export type FieldSpec =
  | {
      readonly kind: 'number'
      readonly unit: SettingUnit
      readonly whole: boolean
      readonly nullable: boolean
      /** A schema `Fraction`: 0 to 1, not percentage points. */
      readonly fraction?: true
      /** A whole number's schema bounds (`ge`/`le`). */
      readonly min?: number
      readonly max?: number
    }
  | { readonly kind: 'yesno' }
  | { readonly kind: 'choice'; readonly options: readonly string[] }
  /** A choice among labelled values; value `''` is None (saved as null). */
  | {
      readonly kind: 'pick'
      readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>
    }
  | { readonly kind: 'date' }
  | {
      readonly kind: 'sessions'
      readonly options: EditContext['sessions']
      readonly claimed: ReadonlySet<number>
    }
  | { readonly kind: 'programs'; readonly options: EditContext['programs'] }

/** What the Rules tab's editor knows that a section's own content doesn't (spec §6.2 F): the choices for the lifted settings. */
export interface EditContext {
  readonly classes: readonly string[]
  /** A class's display label where a program or pool shares its key; a class without one reads in words. */
  readonly classLabels: ReadonlyMap<string, string>
  readonly pools: ReadonlyArray<{ key: string; label: string }>
  readonly sessions: ReadonlyArray<{ id: number; name: string }>
  readonly programs: ReadonlyArray<{ key: string; label: string }>
  /** Sessions another program already claims: never offered in Add a session. */
  readonly claimed: ReadonlySet<number>
}

const MILESTONES: ReadonlySet<string> = new Set([
  'application_deadline',
  'r1_run',
  'response_deadline',
  'r2_window_start',
  'r2_window_end',
  'r3_window_start',
  'r3_window_end',
])

/** The settings spec §6.2 F lifts out of "names, keys, references, dates and lists stay as they are", with the editor's context. */
function liftedSpec(
  path: readonly string[],
  value: unknown,
  context: EditContext
): FieldSpec | null {
  const key = path.at(-1) ?? ''
  if (path.length === 2 && key === 'equity_class') {
    return {
      kind: 'pick',
      options: [
        ...context.classes.map((c) => ({
          value: c,
          label: context.classLabels.get(c) ?? keyWords(c),
        })),
        { value: '', label: 'None' },
      ],
    }
  }
  if (path.length === 2 && key === 'budget_pool') {
    return {
      kind: 'pick',
      options: [
        ...context.pools.map((p) => ({ value: p.key, label: p.label })),
        { value: '', label: 'None' },
      ],
    }
  }
  if (path.length === 2 && key === 'session_cm_ids') {
    // `claimed` counts every program's sessions; this program's own are never "another program's".
    const own = new Set(Array.isArray(value) ? value.map(Number) : [])
    return {
      kind: 'sessions',
      options: context.sessions,
      claimed: new Set([...context.claimed].filter((id) => !own.has(id))),
    }
  }
  if (path.length === 1 && key === 'offset_programs') {
    return { kind: 'programs', options: context.programs }
  }
  if (path.length === 1 && MILESTONES.has(key)) return { kind: 'date' }
  return null
}

const DECIMAL = /^\d+(\.\d+)?$/

/** Whole-number settings with schema bounds (rules/schema.py: `ge`, `le`). */
const WHOLE_BOUNDS: Readonly<Record<string, { min?: number; max?: number }>> = {
  floor_tier: { min: 1 },
  round: { min: 1, max: 3 },
  max_shift: { min: 0 },
  infant_age_cutoff_months: { min: 0 },
}

/** Names, keys and references: they may look like a figure ("2024" as a label) but are never one. */
const FIXED_KEYS: ReadonlySet<string> = new Set(['label', 'field', 'campminder_description', 'key'])

/**
 * Never boxed: a name, a key, or a reference to a CampMinder session or to another table (retyping
 * `session_cm_id` would re-point a rate at another session). `program_tables` maps program to table.
 */
function isFixed(path: readonly string[]): boolean {
  const key = path.at(-1) ?? ''
  // A named award's kind: the server refuses a change (rules/fixed.py `decision_types.*.kind`).
  if (key === 'kind' && path[0] === 'decision_types') return true
  return FIXED_KEYS.has(key) || key.endsWith('_cm_id') || path[0] === 'program_tables'
}

/** Schema `Fraction`s (0 to 1): the income weights, the three rates and an extra term's rate. */
function isFraction(path: readonly string[]): boolean {
  const key = path.at(-1) ?? ''
  if (key === 'prior_year' || key === 'current_year') return path[0] === 'weights'
  if (key === 'rate') return path[0] === 'extra_terms'
  return key === 'medical_rate' || key === 'education_rate' || key === 'savings_inclusion_rate'
}

function numberSpec(path: readonly string[], whole: boolean, nullable: boolean): FieldSpec {
  const key = path.at(-1) ?? ''
  if (isEquityWeight(path)) return { kind: 'number', unit: 'plain', whole, nullable: false }
  return {
    kind: 'number',
    unit: unitOf(path),
    whole,
    nullable,
    ...(!whole && isFraction(path) ? { fraction: true as const } : {}),
    ...(whole ? (WHOLE_BOUNDS[key] ?? {}) : {}),
  }
}

/** How a setting is typed, or null when it stays as it is (a name, a key, a reference, a date, a list). */
export function fieldSpec(
  path: readonly string[],
  value: unknown,
  content?: unknown,
  context?: EditContext
): FieldSpec | null {
  const key = path.at(-1) ?? ''
  if (context !== undefined) {
    const lifted = liftedSpec(path, value, context)
    if (lifted !== null) return lifted
  }
  // The server refuses an extra amount on any decision type but full_cost: no box to type one in.
  if (key === 'extra_amount' && path[0] === 'decision_types' && content !== undefined) {
    if (valueAt(content, [...path.slice(0, -1), 'kind']) !== 'full_cost') return null
  }
  if (typeof value === 'boolean') return { kind: 'yesno' }
  if (isFixed(path)) return null
  const weight = isEquityWeight(path)
  const choices = weight ? undefined : CHOICES[key]
  if (typeof value === 'string' && choices?.includes(value) === true) {
    return { kind: 'choice', options: choices }
  }
  const nullable = !weight && isNullable(path)
  if (typeof value === 'number') return numberSpec(path, Number.isInteger(value), nullable)
  if (typeof value === 'string' && DECIMAL.test(value)) return numberSpec(path, false, nullable)
  if (value === null && nullable) {
    // An empty setting's kind is its field's: counts are whole, money and percentages decimal.
    return numberSpec(path, key in WHOLE_BOUNDS, nullable)
  }
  return null
}

export type Parsed =
  | {
      readonly kind: 'ok'
      readonly value: string | number | boolean | null | ReadonlyArray<string | number>
    }
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * A typed setting back to the server's form: decimals as strings (the schema's Decimal), whole
 * numbers as numbers, an emptied optional setting as null. "$1,000,000" and "72%" read as typed;
 * commas group thousands only.
 */
export function parseSetting(raw: string, spec: FieldSpec): Parsed {
  if (spec.kind === 'yesno') return { kind: 'ok', value: raw === 'true' }
  if (spec.kind === 'choice') {
    return spec.options.includes(raw)
      ? { kind: 'ok', value: raw }
      : { kind: 'invalid', reason: 'Not a choice' }
  }
  if (spec.kind === 'date') {
    if (raw === '') return { kind: 'ok', value: null }
    return /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? { kind: 'ok', value: raw }
      : { kind: 'invalid', reason: 'Not a date' }
  }
  if (spec.kind === 'pick') return { kind: 'ok', value: raw === '' ? null : raw }
  if (spec.kind === 'sessions') {
    return { kind: 'ok', value: raw === '' ? [] : raw.split(',').map(Number) }
  }
  if (spec.kind === 'programs') return { kind: 'ok', value: raw === '' ? [] : raw.split(',') }
  // Only the box's own symbol is dropped; the other one is a mistake to name, not to guess at.
  let text = raw.trim()
  if (spec.unit === 'money') text = text.replace(/^\$\s*/, '')
  if (spec.unit === 'percent') text = text.replace(/\s*%$/, '')
  if (text.includes('$')) return { kind: 'invalid', reason: 'No $ in this box' }
  if (text.includes('%')) return { kind: 'invalid', reason: 'No % in this box' }
  if (text === '') {
    return spec.nullable
      ? { kind: 'ok', value: null }
      : { kind: 'invalid', reason: 'Needs a figure' }
  }
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)
  if (!grouped && !DECIMAL.test(text)) return { kind: 'invalid', reason: 'Not a number' }
  const digits = text.replaceAll(',', '')
  if (spec.whole) {
    if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits))) {
      return { kind: 'invalid', reason: 'A whole number' }
    }
    const n = Number(digits)
    if (spec.min !== undefined && n < spec.min) {
      return { kind: 'invalid', reason: `At least ${String(spec.min)}` }
    }
    if (spec.max !== undefined && n > spec.max) {
      return { kind: 'invalid', reason: `At most ${String(spec.max)}` }
    }
    return { kind: 'ok', value: n }
  }
  if (spec.fraction === true) {
    // A fraction is typed as a fraction: "0.25", never "25%" (the schema's 0..1).
    if (text !== digits || exceeds(digits, 1n)) {
      return { kind: 'invalid', reason: 'Between 0 and 1' }
    }
    return { kind: 'ok', value: digits }
  }
  if (spec.unit === 'money' && !/^\d+(\.\d{1,2})?$/.test(digits)) {
    return { kind: 'invalid', reason: 'Cents go to two places' }
  }
  if (spec.unit === 'percent' && exceeds(digits, 100n)) {
    return { kind: 'invalid', reason: 'At most 100%' }
  }
  return { kind: 'ok', value: digits }
}

/** Whether a non-negative decimal string is above a whole limit, by digits (no float maths). */
function exceeds(digits: string, limit: bigint): boolean {
  const [whole = '0', fraction = ''] = digits.split('.')
  const int = BigInt(whole)
  return int > limit || (int === limit && /[1-9]/.test(fraction))
}

/** What a setting's box shows before anything is typed. */
export function rawOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

/**
 * What a box shows before anything is typed: a money figure in whole dollars with commas ("6695.0" is "6,695"),
 * and its cents as stored ("6695.5" is "6,695.50"), never rounded (coordinator B7; lead ruling). `parseSetting`
 * reads the commas back, and `sameAt` reads "6,695" as the stored "6695.0", so a box left as shown is no change.
 */
export function boxText(value: unknown, spec: FieldSpec): string {
  const raw = rawOf(value)
  if (spec.kind !== 'number' || spec.unit !== 'money' || !DECIMAL.test(raw)) return raw
  const [whole = '0', fraction = ''] = raw.split('.')
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',')
  if (/^0*$/.test(fraction)) return grouped
  return `${grouped}.${fraction.padEnd(2, '0')}`
}

/** An edit's key: its path inside the section. */
export function editKey(path: readonly string[]): string {
  return JSON.stringify(path)
}

export function pathOf(key: string): string[] {
  const parsed: unknown = JSON.parse(key)
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `content` with the value at `path` replaced, nothing else touched (lists keep their order). */
export function setAt(content: unknown, path: readonly string[], value: unknown): unknown {
  const [head, ...rest] = path
  if (head === undefined) return value
  if (Array.isArray(content)) {
    const index = Number(head)
    return content.map((item: unknown, i) => (i === index ? setAt(item, rest, value) : item))
  }
  const record = isRecord(content) ? content : {}
  return { ...record, [head]: setAt(record[head], rest, value) }
}

export function valueAt(content: unknown, path: readonly string[]): unknown {
  let here: unknown = content
  for (const part of path) {
    if (Array.isArray(here)) here = here[Number(part)]
    else if (isRecord(here)) here = here[part]
    else return undefined
  }
  return here
}

/** Whether two paths overlap: one is the other, or sits inside it (a list's row is inside its list). */
export function touches(a: readonly string[], b: readonly string[]): boolean {
  const n = Math.min(a.length, b.length)
  return a.slice(0, n).every((part, i) => part === b[i])
}

export interface Applied {
  readonly content: Record<string, unknown>
  /** Each box that can't be read yet, by its edit key, in the box's own words. */
  readonly problems: ReadonlyMap<string, string>
  /** The edits (also in `problems`) whose setting is no longer in the section, by edit key. */
  readonly gone: ReadonlySet<string>
  /** The paths whose value differs from the section as it opened. */
  readonly changed: readonly string[][]
}

/** "Row 3 of Income bands is gone; retype it": the first step of `path` that no longer resolves. */
function goneWords(opened: unknown, path: readonly string[]): string {
  let here: unknown = opened
  for (const [i, part] of path.entries()) {
    const next = Array.isArray(here) ? here[Number(part)] : isRecord(here) ? here[part] : undefined
    if (next === undefined) {
      const list = path.slice(0, i)
      return Array.isArray(here)
        ? `Row ${String(Number(part) + 1)} of ${fieldName(list)} is gone; retype it`
        : `${fieldName(path.slice(0, i + 1))} is gone; retype it`
    }
    here = next
  }
  return `${fieldName(path)} is gone; retype it`
}

/**
 * The section with every typed box applied. A box that can't be read leaves its setting as it
 * was, and is named in `problems`; nothing is sent while any is. A typed setting that is no longer
 * in the section (a row the opened content lost) is named too, in `problems` and `gone`, never
 * dropped silently.
 */
export function applyEdits(
  opened: Readonly<Record<string, unknown>>,
  edits: ReadonlyMap<string, string>,
  specOf: (path: readonly string[]) => FieldSpec | null
): Applied {
  let content: unknown = opened
  const problems = new Map<string, string>()
  const gone = new Set<string>()
  const changed: string[][] = []
  for (const [key, raw] of edits) {
    const path = pathOf(key)
    const spec = specOf(path)
    if (spec === null) {
      if (valueAt(opened, path) === undefined) {
        problems.set(key, goneWords(opened, path))
        gone.add(key)
      }
      continue
    }
    const parsed = parseSetting(raw, spec)
    if (parsed.kind === 'invalid') {
      problems.set(key, parsed.reason)
      continue
    }
    const before = valueAt(opened, path)
    if (sameAt(before, parsed.value, path)) continue
    content = setAt(content, path, parsed.value)
    changed.push(path)
  }
  return { content: isRecord(content) ? content : {}, problems, gone, changed }
}

/** A decimal's value as digits without padding zeros ("72.00" is "72"), for comparing without floats. */
function normalDecimal(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !DECIMAL.test(text)) return null
  const [whole = '0', fraction = ''] = text.split('.')
  const kept = fraction.replace(/0+$/, '')
  return `${whole.replace(/^0+(?=\d)/, '')}${kept === '' ? '' : `.${kept}`}`
}

/**
 * Equal as the server compares (change_diff.values_equal) given where the value sits: a figure
 * ("72" and "72.00") by value, since the schema holds a Decimal there; anything else, text and the
 * items of a list of plain values included, exactly, since the server never parses a string. Yes is
 * never 1.
 */
function sameAt(a: unknown, b: unknown, path: readonly string[]): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item: unknown, i) =>
        isRecord(item) || Array.isArray(item)
          ? sameAt(item, b[i], [...path, String(i)])
          : item === b[i]
      )
    )
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameAt(a[key], b[key], [...path, key]))
    )
  }
  if (fieldSpec(path, a)?.kind === 'number' || fieldSpec(path, b)?.kind === 'number') {
    const x = normalDecimal(a)
    const y = normalDecimal(b)
    if (x !== null && y !== null) return x === y
  }
  return a === b
}

/** An added or removed set of settings, listed leaf by leaf as the server lists it. */
function leaves(value: unknown, path: string[]): Array<{ path: string[]; value: unknown }> {
  if (isRecord(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]))
  }
  return [{ path, value }]
}

/**
 * Every setting that differs between two copies of a section, as the server's changes read
 * (change_diff.field_changes: lists compared whole, an added or removed group listed leaf by leaf,
 * `before` null on an add and `after` null on a remove). Mirrors Python `FieldChange`. The order is the
 * section's own, not the server's sort by path; nothing compares the two. The editor's G6 answer
 * uses it: what someone else changed since this editor opened. A change inside a list is reported
 * at the list's path, so a home overlaps it with an edit through `touches`, never by equality.
 */
export function sectionChanges(
  before: unknown,
  after: unknown,
  path: string[] = []
): ApiAidFieldChange[] {
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys.flatMap((key) => {
      if (!(key in after)) {
        return leaves(before[key], [...path, key]).map((leaf) => ({
          path: leaf.path,
          kind: 'removed' as const,
          before: leaf.value,
          after: null,
        }))
      }
      if (!(key in before)) {
        return leaves(after[key], [...path, key]).map((leaf) => ({
          path: leaf.path,
          kind: 'added' as const,
          before: null,
          after: leaf.value,
        }))
      }
      return sectionChanges(before[key], after[key], [...path, key])
    })
  }
  return sameAt(before, after, path) ? [] : [{ path, kind: 'changed', before, after }]
}

/** "General › Tiers › Tier 2 › Round 1 %": a setting's full name, for its box and for a change. */
export function fieldName(path: readonly string[]): string {
  return path.map((_, index) => labelOf(path.slice(0, index + 1))).join(' › ')
}

/**
 * A section save's 422 ("awards is not a valid section: awards.decision_types.x.extra_amount: Value
 * error, …") as a sentence naming each field the way its box is named; null for any other message.
 * The server's reason stays, as it wrote it.
 */
export function refusalWords(message: string): string | null {
  const lead = /^\w+ is not a valid section: (.+)$/s.exec(message)
  if (lead?.[1] === undefined) return null
  const parts = lead[1].split('; ').map((detail) => {
    const at = detail.indexOf(': ')
    if (at < 0) return detail
    const path = detail.slice(0, at).split('.').slice(1)
    const reason = detail.slice(at + 2).replace(/^Value error, /, '')
    return path.length === 0 ? reason : `${fieldName(path)}: ${reason}`
  })
  return `The rules draft refused this change: ${parts.join('; ')}.`
}

/** The boxes that can't be read, in one line: "‹label› (‹reason›)", or the reason alone for a setting that is gone. */
export function fixFirstWords(applied: Applied): string {
  return [...applied.problems]
    .map(([key, reason]) =>
      applied.gone.has(key) ? reason : `${fieldName(pathOf(key))} (${reason})`
    )
    .join('; ')
}

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

/** What a section save sends beyond the boxes (spec §6.2 F, §9.9): the server's routing, derived and full forms. */
export function prepareContent(
  section: ApiAidRulesSection,
  content: Record<string, unknown>,
  document: ApiAidRulesDraft['document']
): Record<string, unknown> {
  if (section === 'round2') {
    const allByClass = Object.values(record(document.programs)).every(
      (p) => record(p)['table_from_equity_class'] === true
    )
    return allByClass ? { ...content, program_tables: {} } : content
  }
  if (section === 'income') {
    const weights = Object.fromEntries(
      Object.entries(record(content['weights'])).filter(([field]) => field !== 'current_year')
    )
    return { ...content, weights }
  }
  if (section === 'equity') {
    const keys = (Array.isArray(content['criteria']) ? content['criteria'] : []).map((c) =>
      String(record(c)['key'])
    )
    const weights = Object.fromEntries(
      Object.entries(record(content['weights'])).map(([cls, row]) => [
        cls,
        { ...Object.fromEntries(keys.map((k) => [k, '0'])), ...record(row) },
      ])
    )
    return { ...content, weights }
  }
  return content
}
