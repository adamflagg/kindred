/**
 * The sandbox's three cards as data (Scenarios addendum §S5 F). Typed edits, keyed by dotted path, become the
 * document the strip prices and a release records. The bands are PR 9's (tierGrid.ts: start, width, count, the +$1
 * edge); a new count trims or fills both tables, because PUT /draft stores a whole document that must validate and
 * price on every keystroke (it differs on purpose from Rules, where new tiers stay empty). Pure.
 */
import type { ApiAidRulesDocument } from '../../../../types/api-types'
import { formatWholeMoney } from '../../kit/money'
import { CARD_SPECS, CHOICE_WORDS } from '../rules/rulesCards'
import { keyWords } from '../rules/rulesModel'
import { bandsIn, bandsOf, evenOf, type TableShape } from '../rules/tierGrid'

type Doc = ApiAidRulesDocument
type Json = Record<string, unknown>

export const TIER_START = 'tiers.start'
export const TIER_WIDTH = 'tiers.width'
export const TIER_COUNT = 'tiers.count'
export const CEILING = 'tiers.income_ceiling'
export const MINIMUM = 'awards.minimum'
export const PRIOR_WEIGHT = 'income.weights.prior_year'
export const DEPENDENTS = 'income.dependents_mode'
export const INCOME_MONEY = [
  'income.medical_threshold',
  'income.education_threshold',
  'income.savings_threshold',
  'income.per_dependent_reduction',
] as const

export const cellKey = (part: 'r1' | 'cap', table: string, tier: number) =>
  part === 'r1'
    ? `award_tables.${table}.tiers.${String(tier)}.r1_pct`
    : `round2.tables.${table}.tiers.${String(tier)}.total_pct`
export const enabledKey = (index: number) => `equity.criteria.${String(index)}.enabled`
export const weightKey = (cls: string, criterion: string) => `equity.weights.${cls}.${criterion}`

export type Problem =
  | 'not a figure'
  | 'needs a figure'
  | 'not below 0'
  | '0 to 100'
  | 'above 0'
  | 'a whole number from 2 to 20'
export type Kind =
  'money' | 'money?' | 'pct' | 'frac' | 'weight' | 'count' | 'width' | 'bool' | 'choice'

const TIER_KEYS: readonly string[] = [TIER_START, TIER_WIDTH, TIER_COUNT]

export function kindOf(key: string): Kind {
  if (key === TIER_WIDTH) return 'width'
  if (key === TIER_COUNT) return 'count'
  if (key === CEILING) return 'money?'
  if (key === TIER_START || key === MINIMUM || (INCOME_MONEY as readonly string[]).includes(key))
    return 'money'
  if (key === PRIOR_WEIGHT) return 'frac'
  if (key === DEPENDENTS) return 'choice'
  if (key.endsWith('.enabled')) return 'bool'
  if (key.startsWith('equity.weights.')) return 'weight'
  return 'pct'
}

/** A typed figure, or why not, in the Rules editor's words (parent §6.2 F) with the mock's reasons. */
export function readFigure(
  raw: string,
  kind: Kind
): { value: number | null } | { problem: Problem } {
  const text = raw.replaceAll(',', '').trim()
  if (text === '') return kind === 'money?' ? { value: null } : { problem: 'needs a figure' }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { problem: 'not a figure' }
  const n = Number(text)
  if (n < 0) return { problem: 'not below 0' }
  if ((kind === 'pct' || kind === 'frac') && n > 100) return { problem: '0 to 100' }
  if (kind === 'width' && n <= 0) return { problem: 'above 0' }
  if (kind === 'count' && (!Number.isInteger(n) || n < 2 || n > 20))
    return { problem: 'a whole number from 2 to 20' }
  return { value: n }
}

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const decimal = (n: number) => String(Number(n.toFixed(4)))

function at(node: unknown, path: readonly string[]): unknown {
  let here = node
  for (const part of path) {
    if (Array.isArray(here)) here = here[Number(part)]
    else if (isRecord(here)) here = here[part]
    else return undefined
  }
  return here
}

function setAt(node: Json, path: readonly string[], value: unknown): void {
  let here: unknown = node
  path.slice(0, -1).forEach((part, i) => {
    const next = path[i + 1] ?? ''
    if (Array.isArray(here)) here = here[Number(part)]
    else if (isRecord(here)) {
      if (!isRecord(here[part]) && !Array.isArray(here[part]))
        here[part] = /^\d+$/.test(next) && part === 'criteria' ? [] : {}
      here = here[part]
    }
  })
  const last = path[path.length - 1] ?? ''
  if (Array.isArray(here)) {
    const row = here[Number(last)]
    if (row !== undefined) here[Number(last)] = value
  } else if (isRecord(here)) here[last] = value
}

export interface TierLine {
  readonly start: number
  readonly width: number
  readonly count: number
}

/** The tiers line's three figures: even bands' own, or for bands set by hand the first band's start and width and
 * the number of bands (§S5 F1). */
export function tierLine(document: Doc): TierLine {
  const bands = bandsIn(document.tiers)
  const even = evenOf(bands)
  if (even !== null) return even
  const first = bands[0]
  const start = Number(first?.lower ?? 0)
  const width =
    first?.upper === null || first?.upper === undefined ? 0 : Number(first.upper) - start
  return { start, width, count: bands.length }
}

/** Each table's tiers above `count` go, overrides included; an own table copies its last tier into each new one. */
function resizeTables(doc: Json, count: number): void {
  for (const tables of [at(doc, ['award_tables']), at(doc, ['round2', 'tables'])]) {
    if (!isRecord(tables)) continue
    for (const table of Object.values(tables)) {
      if (!isRecord(table)) continue
      const tiers = isRecord(table['tiers']) ? table['tiers'] : {}
      const numbers = Object.keys(tiers)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
      const top = numbers[numbers.length - 1]
      if (top !== undefined) {
        const last = tiers[String(top)]
        const next: Json = {}
        for (let tier = 1; tier <= count; tier += 1)
          next[String(tier)] = tiers[String(tier)] ?? structuredClone(last)
        table['tiers'] = next
      }
      if (isRecord(table['overrides'])) {
        table['overrides'] = Object.fromEntries(
          Object.entries(table['overrides']).filter(([tier]) => Number(tier) <= count)
        )
      }
    }
  }
}

export interface Applied {
  readonly document: Doc
  readonly problems: ReadonlyMap<string, Problem>
}

/** The typed edits on `document`: what the strip prices and a release records. A bad figure is left out (its box
 * shows red), and the edits beside it still apply. */
export function applyEdits(document: Doc, edits: ReadonlyMap<string, string>): Applied {
  const doc = structuredClone(document) as unknown as Json
  const problems = new Map<string, Problem>()
  const line = { ...tierLine(document) }
  let bandsTyped = false
  for (const [key, raw] of edits) {
    const path = key.split('.')
    const kind = kindOf(key)
    if (kind === 'bool') {
      setAt(doc, path, raw === 'true')
      continue
    }
    if (kind === 'choice') {
      setAt(doc, path, raw)
      continue
    }
    const read = readFigure(raw, kind)
    if ('problem' in read) {
      problems.set(key, read.problem)
      continue
    }
    const value = read.value
    if (key === TIER_START || key === TIER_WIDTH || key === TIER_COUNT) {
      bandsTyped = true
      if (key === TIER_START) line.start = value ?? 0
      else if (key === TIER_WIDTH) line.width = value ?? 0
      else line.count = value ?? 0
    } else if (kind === 'frac') {
      const prior = (value ?? 0) / 100
      setAt(doc, path, decimal(prior))
      setAt(doc, ['income', 'weights', 'current_year'], decimal(1 - prior)) // §S11.5; the server derives it too
    } else {
      setAt(doc, path, value === null ? null : String(value))
    }
  }
  if (bandsTyped && !TIER_KEYS.some((key) => problems.has(key))) {
    setAt(doc, ['tiers', 'bands'], bandsOf(line.start, line.width, line.count))
    resizeTables(doc, line.count)
  }
  return { document: doc as unknown as Doc, problems }
}

const numeric = (value: unknown) =>
  typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    ? Number(value)
    : null

function sameValue(a: unknown, b: unknown): boolean {
  const x = numeric(a)
  const y = numeric(b)
  if (x !== null && y !== null) return x === y
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** What a box shows: digits for money and %, the prior-year weight as a %, a tier figure from the tiers line. */
export function shownValue(key: string, document: Doc): string {
  if (TIER_KEYS.includes(key)) {
    const line = tierLine(document)
    return String(key === TIER_START ? line.start : key === TIER_WIDTH ? line.width : line.count)
  }
  const value = at(document, key.split('.'))
  if (value === null || value === undefined) return ''
  if (kindOf(key) === 'frac') return String(Number((Number(value) * 100).toFixed(2)))
  return String(value)
}

function words(key: string, value: unknown): string {
  if (value === undefined) return '—'
  const kind = kindOf(key)
  if (kind === 'bool') return value === false ? 'unchecked' : 'checked'
  if (kind === 'choice') return CHOICE_WORDS['dependents_mode']?.[String(value)] ?? String(value)
  if (value === null) return 'none'
  if (kind === 'money' || kind === 'money?' || kind === 'width')
    return formatWholeMoney(Number(value))
  if (kind === 'pct') return `${String(Number(value))}%`
  if (kind === 'frac') return `${String(Number((Number(value) * 100).toFixed(2)))}%`
  return String(Number(value))
}

/** "was ‹old›" beside a changed box (§S5 F): the starting point's value; "—" for a tier the count just added. */
export function wasWords(key: string, typed: Doc, source: Doc | null): string | null {
  if (source === null) return null
  if (TIER_KEYS.includes(key)) {
    const now = tierLine(typed)
    const then = tierLine(source)
    const field = key === TIER_START ? 'start' : key === TIER_WIDTH ? 'width' : 'count'
    if (now[field] === then[field]) return null
    return `was ${field === 'count' ? String(then.count) : formatWholeMoney(then[field])}`
  }
  const path = key.split('.')
  const now = at(typed, path)
  const then = at(source, path)
  if (kindOf(key) === 'bool' ? (now !== false) === (then !== false) : sameValue(now, then))
    return null
  return `was ${words(key, then)}`
}

function leaves(a: unknown, b: unknown): number {
  if (isRecord(a) && isRecord(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce(
      (n, key) => n + leaves(a[key], b[key]),
      0
    )
  }
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.every(isRecord) &&
    b.every(isRecord) &&
    a.length === b.length &&
    !a.some((x) => 'lower' in x)
  ) {
    return a.reduce((n: number, item, i) => n + leaves(item, b[i]), 0)
  }
  return sameValue(a, b) || JSON.stringify(a) === JSON.stringify(b) ? 0 : 1
}

/** How many settings differ from the starting point ("‹n› changes"; the bands count as one, as the server's). */
export const changeCount = (typed: Doc, source: Doc) => leaves(typed, source)

export type SandboxCard = 'tiers' | 'equity' | 'income'

const CARD_SECTIONS: Readonly<Record<SandboxCard, readonly string[]>> = {
  tiers: ['tiers', 'award_tables', 'awards'],
  equity: ['equity'],
  income: ['income'],
}

/** "Locked: Round 1 is posted" once per card (§S5 F); the Tiers card adds that the cap stays open until Round 2
 * posts (owner, §S15 item 5: "yup"). */
export function lockNote(
  card: SandboxCard,
  locked: readonly string[],
  byRound: number | null
): string | null {
  const cap = locked.includes('round2')
  if (
    !CARD_SECTIONS[card].some((section) => locked.includes(section)) &&
    !(card === 'tiers' && cap)
  )
    return null
  const note = `Locked: Round ${String(byRound ?? 1)} is posted`
  return card === 'tiers' && !cap ? `${note} · the Round 1 + 2 cap stays open` : note
}

export function keyLocked(key: string, locked: readonly string[]): boolean {
  const section = TIER_KEYS.includes(key) ? 'tiers' : (key.split('.')[0] ?? '')
  return locked.includes(section)
}

/** The read-only strip's current-year weight, following the typed prior-year weight (§S5 F3). */
export function currentYearWords(document: Doc): string {
  const prior = Number(document.income.weights.prior_year)
  return `${String(Number(((1 - prior) * 100).toFixed(2)))}%`
}

const incomeLabel = (field: string) =>
  CARD_SPECS.income?.groups
    .flatMap((group) => group.rows)
    .find((row) => row.path.join('.') === field)?.label ?? keyWords(field)

/** A box's label, for "Fix first": the card's own words (rulesCards.ts). */
export function keyLabel(key: string, document: Doc): string {
  const fixed: Record<string, string> = {
    [TIER_START]: 'Start',
    [TIER_WIDTH]: 'Band width',
    [TIER_COUNT]: 'Tiers',
    [CEILING]: 'Income ceiling',
    [MINIMUM]: 'Minimum award',
  }
  const known = fixed[key]
  if (known !== undefined) return known
  const path = key.split('.')
  if (path[0] === 'income') return incomeLabel(path.slice(1).join('.'))
  if (path[0] === 'award_tables')
    return `Round 1 % › ${keyWords(path[1] ?? '')} › Tier ${path[3] ?? ''}`
  if (path[0] === 'round2')
    return `Round 1 + 2 cap › ${keyWords(path[2] ?? '')} › Tier ${path[4] ?? ''}`
  const criteria = document.equity.criteria ?? []
  if (path[1] === 'weights') {
    const label = criteria.find((c) => c.key === path[3])?.label ?? keyWords(path[3] ?? '')
    return `Weight › ${keyWords(path[2] ?? '')} › ${label}`
  }
  return `${criteria[Number(path[2])]?.label ?? ''} › Enabled`
}

/** "Fix first: Band width (above 0); Minimum award (needs a figure)" (§S5 F), or null. */
export function fixFirstWords(
  problems: ReadonlyMap<string, Problem>,
  document: Doc
): string | null {
  if (problems.size === 0) return null
  return `Fix first: ${[...problems].map(([key, problem]) => `${keyLabel(key, document)} (${problem})`).join('; ')}`
}

/** Only a table's own cells are boxes; an inheriting table's cells (and its overrides) read only (§S5 F1). */
export function cellEditable(document: Doc, part: 'r1' | 'cap', table: string): boolean {
  const tables = (
    part === 'r1' ? document.award_tables : (document.round2.tables ?? {})
  ) as Readonly<Record<string, TableShape>>
  const shape = tables[table]
  return shape !== undefined && (shape.inherits === null || shape.inherits === undefined)
}
