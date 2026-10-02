/**
 * Editing one rules section in place (spec §7.5; D39: one editor per section; slice 2 Decisions
 * 14–16). Pure. What can be typed: every number, yes/no and choice the section already holds, and the
 * settings the schema lets be empty (an income ceiling, a Round 3 limit). Names, keys, references,
 * dates and lists stay as they are: adding a band, a program or a table is the season-description
 * forms', which come later (D39's build order). The server validates the whole section on save.
 */
import type {
  ApiAidDecisionType,
  ApiAidFieldChange,
  ApiAidIncentiveRule,
  ApiAidProgramProfile,
  ApiAidRulesDocument,
} from '../../../../types/api-types'
import { labelOf, unitOf, type SettingUnit } from './rulesModel'

/** Settings the schema lets be empty (`… | None`), whose box may be cleared (rules/schema.py). */
const NULLABLE: ReadonlySet<string> = new Set([
  'income_ceiling',
  'upper',
  'child',
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
  mode: options({ ignore: true, reduce_cost: true, reduce_award: true } satisfies Options<
    ApiAidIncentiveRule['mode']
  >),
  kind: options({ full_cost: true, top_up: true, discretionary: true } satisfies Options<
    ApiAidDecisionType['kind']
  >),
  spillover: options({ none: true, shared: true } satisfies Options<Doc['budget']['spillover']>),
  commit_on: options({ offered: true, accepted: true } satisfies Options<
    Doc['budget']['commit_on']
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

const DECIMAL = /^\d+(\.\d+)?$/

/** Whole-number settings with schema bounds (rules/schema.py: `ge`, `le`). */
const WHOLE_BOUNDS: Readonly<Record<string, { min?: number; max?: number }>> = {
  floor_tier: { min: 1 },
  round: { min: 1, max: 3 },
  max_shift: { min: 0 },
  infant_age_cutoff_months: { min: 0 },
}

/** Text that may look like a figure ("2024" as a label) but is never one. */
const TEXT_KEYS: ReadonlySet<string> = new Set([
  'label',
  'field',
  'budget_line',
  'campminder_description',
  'code',
  'key',
])

/** Schema `Fraction`s (0 to 1): the income weights, the three rates and an extra term's rate. */
function isFraction(path: readonly string[]): boolean {
  const key = path.at(-1) ?? ''
  if (key === 'prior_year' || key === 'current_year') return path[0] === 'weights'
  if (key === 'rate') return path[0] === 'extra_terms'
  return key === 'medical_rate' || key === 'education_rate' || key === 'savings_inclusion_rate'
}

function numberSpec(path: readonly string[], whole: boolean, nullable: boolean): FieldSpec {
  const key = path.at(-1) ?? ''
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
export function fieldSpec(path: readonly string[], value: unknown): FieldSpec | null {
  const key = path.at(-1) ?? ''
  if (typeof value === 'boolean') return { kind: 'yesno' }
  if (TEXT_KEYS.has(key)) return null
  const choices = CHOICES[key]
  if (typeof value === 'string' && choices?.includes(value) === true) {
    return { kind: 'choice', options: choices }
  }
  const nullable = isNullable(path)
  if (typeof value === 'number') return numberSpec(path, Number.isInteger(value), nullable)
  if (typeof value === 'string' && DECIMAL.test(value)) return numberSpec(path, false, nullable)
  if (value === null && nullable) {
    // An empty setting's kind is its field's: counts are whole, money and percentages decimal.
    return numberSpec(path, key in WHOLE_BOUNDS, nullable)
  }
  return null
}

export type Parsed =
  | { readonly kind: 'ok'; readonly value: string | number | boolean | null }
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
  const text = raw
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/\s*%$/, '')
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
    if (text !== digits || raw.includes('%') || exceeds(digits, 1n)) {
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
  return String(value)
}

/** An edit's key: its path inside the section. */
export function editKey(path: readonly string[]): string {
  return JSON.stringify(path)
}

function pathOf(key: string): string[] {
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

export interface Applied {
  readonly content: Record<string, unknown>
  /** Each box that can't be read yet, by its edit key, in the box's own words. */
  readonly problems: ReadonlyMap<string, string>
  /** The paths whose value differs from the section as it opened. */
  readonly changed: readonly string[][]
}

/**
 * The section with every typed box applied. A box that can't be read leaves its setting as it
 * was, and is named in `problems`; nothing is sent while any is.
 */
export function applyEdits(
  opened: Readonly<Record<string, unknown>>,
  edits: ReadonlyMap<string, string>,
  specOf: (path: readonly string[]) => FieldSpec | null
): Applied {
  let content: unknown = opened
  const problems = new Map<string, string>()
  const changed: string[][] = []
  for (const [key, raw] of edits) {
    const path = pathOf(key)
    const spec = specOf(path)
    if (spec === null) continue
    const parsed = parseSetting(raw, spec)
    if (parsed.kind === 'invalid') {
      problems.set(key, parsed.reason)
      continue
    }
    const before = valueAt(opened, path)
    if (same(before, parsed.value)) continue
    content = setAt(content, path, parsed.value)
    changed.push(path)
  }
  return { content: isRecord(content) ? content : {}, problems, changed }
}

/** A decimal's value as digits without padding zeros ("72.00" is "72"), for comparing without floats. */
function normalDecimal(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !DECIMAL.test(text)) return null
  const [whole = '0', fraction = ''] = text.split('.')
  const kept = fraction.replace(/0+$/, '')
  return `${whole.replace(/^0+(?=\d)/, '')}${kept === '' ? '' : `.${kept}`}`
}

/** Equal as the server compares (change_diff.values_equal): "72" equals "72.00"; yes is never 1. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b
  const x = normalDecimal(a)
  const y = normalDecimal(b)
  if (x !== null && y !== null) return x === y
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item: unknown, i) => same(item, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
    )
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
 * (change_diff.field_changes: lists compared whole, an added or removed group listed leaf by leaf).
 * The editor's G6 answer uses it: what someone else changed since this editor opened.
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
        }))
      }
      if (!(key in before)) {
        return leaves(after[key], [...path, key]).map((leaf) => ({
          path: leaf.path,
          kind: 'added' as const,
          after: leaf.value,
        }))
      }
      return sectionChanges(before[key], after[key], [...path, key])
    })
  }
  return same(before, after) ? [] : [{ path, kind: 'changed', before, after }]
}

/** "General › Tiers › Tier 2 › Round 1 %": a setting's full name, for its box and for a change. */
export function fieldName(path: readonly string[]): string {
  return path.map((_, index) => labelOf(path.slice(0, index + 1))).join(' › ')
}
