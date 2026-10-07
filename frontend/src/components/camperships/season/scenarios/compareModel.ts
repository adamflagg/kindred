/** Compare (Scenarios addendum §S5 H): Columns ▾, the heads and the table's rows. Every column is priced on the
 * same applications, now, and counts against the rules in effect (N3, N4). Pure. */
import type { AidRequestSet, CompareQuery } from '../../../../services/camperships/aidApi'
import type {
  ApiAidCompareColumn,
  ApiAidLastSeason,
  ApiAidScenarioCompare,
  ApiAidScenarioOption,
  ApiAidScenarioWorkspace,
} from '../../../../types/api-types'
import { campToday, formatShortDate } from '../../kit/dates'
import { formatWholeMoney, toCents } from '../../kit/money'
import {
  formatSetting,
  isRulesSection,
  labelOf,
  SECTION_TITLES,
  unitOf,
  type RulesNames,
  type RulesVocabulary,
} from '../rules/rulesModel'
import { rangeWords } from '../rules/tierGrid'
import { pricedOnWords, ROUND1_SECTIONS, type ScenarioView } from './controlsModel'
import { roughly } from './spendModel'

export const MAX_KEPT_COLUMNS = 4

export type ColumnKey = 'rules' | 'last_rules' | 'draft' | 'last_season' | `kept:${string}`

export interface ColumnChoice {
  readonly key: ColumnKey
  readonly label: string
  readonly disabled: boolean
}

export const optionName = (option: ApiAidScenarioOption) =>
  (option.name ?? '') === '' ? option.label : (option.name ?? '')

/** Columns ▾'s list, in the one fixed order the table shows (§S5 H): it reads the same each time. */
export function columnChoices(workspace: ApiAidScenarioWorkspace, unkept: boolean): ColumnChoice[] {
  const effect =
    workspace.pricing_version === null
      ? `Rules draft v${String(workspace.rules_version)}`
      : `Rules v${String(workspace.pricing_version)} in effect`
  const last = workspace.last_rules_version ?? null
  const choices: ColumnChoice[] = [
    { key: 'rules', label: effect, disabled: false },
    {
      key: 'last_rules',
      label: last === null ? "Last season's rules (none approved)" : "Last season's rules",
      disabled: last === null,
    },
  ]
  if (unkept) choices.push({ key: 'draft', label: 'Your draft, not kept', disabled: false })
  for (const option of workspace.options)
    choices.push({
      key: `kept:${option.code}`,
      label: `${option.code} · ${optionName(option)}`,
      disabled: false,
    })
  choices.push({ key: 'last_season', label: 'Last season, posted', disabled: false })
  return choices
}

const counted = (key: ColumnKey) => key === 'draft' || key.startsWith('kept:')

/** A click in Columns ▾: four at most across the draft and kept options; the result in the fixed order. */
export function toggleColumn(
  checked: readonly ColumnKey[],
  key: ColumnKey,
  order: readonly ColumnKey[]
): { checked: ColumnKey[]; refused: string | null } {
  if (checked.includes(key)) return { checked: checked.filter((k) => k !== key), refused: null }
  if (counted(key) && checked.filter(counted).length >= MAX_KEPT_COLUMNS) {
    const name = key === 'draft' ? 'your draft' : key.slice('kept:'.length)
    return {
      checked: [...checked],
      refused: `Four kept options are already columns: uncheck one to add ${name}.`,
    }
  }
  const next = new Set([...checked, key])
  return { checked: order.filter((k) => next.has(k)), refused: null }
}

/** The first open with nothing checked (§S5 H): the rules in effect, the three newest kept options, last season. */
export function defaultColumns(workspace: ApiAidScenarioWorkspace): ColumnKey[] {
  const newest = [...workspace.options]
    .sort((a, b) => b.kept_at.localeCompare(a.kept_at))
    .slice(0, 3)
    .map((option) => `kept:${option.code}` as const)
  return columnChoices(workspace, false)
    .map((choice) => choice.key)
    .filter(
      (key) =>
        key === 'rules' || key === 'last_season' || (newest as readonly string[]).includes(key)
    )
}

export function columnsFromView(
  view: Pick<ScenarioView, 'codes' | 'rules' | 'lastRules' | 'draft' | 'lastSeason'>
): ColumnKey[] {
  return [
    ...(view.rules ? (['rules'] as const) : []),
    ...(view.lastRules ? (['last_rules'] as const) : []),
    ...(view.draft ? (['draft'] as const) : []),
    ...view.codes.map((code) => `kept:${code}` as const),
    ...(view.lastSeason ? (['last_season'] as const) : []),
  ]
}

export function compareQuery(
  checked: readonly ColumnKey[],
  requestSet: AidRequestSet
): CompareQuery {
  return {
    codes: checked.filter((k) => k.startsWith('kept:')).map((k) => k.slice('kept:'.length)),
    requestSet,
    lastSeason: checked.includes('last_season'),
    rules: checked.includes('rules'),
    lastRules: checked.includes('last_rules'),
    draft: checked.includes('draft'),
  }
}

export type CompareSource =
  | { readonly kind: 'priced'; readonly column: ApiAidCompareColumn }
  | { readonly kind: 'season'; readonly last: ApiAidLastSeason }

/** The server's columns (already in the fixed order), then last season when it is loaded. */
export function compareSources(
  compare: ApiAidScenarioCompare,
  lastSeason: boolean
): CompareSource[] {
  const priced: CompareSource[] = compare.columns.map((column) => ({ kind: 'priced', column }))
  const last = compare.last_season ?? null
  return lastSeason && last?.loaded === true ? [...priced, { kind: 'season', last }] : priced
}

export interface ColumnHead {
  readonly code: string
  readonly chip: string
  readonly chipTone: 'kept' | 'draft' | 'plain'
  readonly name: string
  readonly meta: string
  readonly option: ApiAidScenarioOption | null
}

const day = (iso: string) => formatShortDate(campToday(new Date(iso)))

/** Each column's chip, name and meta line (§S5 H). A kept option's meta is what it priced the day it was kept, on
 * that day's whole pile, never recomputed. */
export function columnHeads(
  sources: readonly CompareSource[],
  workspace: ApiAidScenarioWorkspace,
  draftName: string,
  year: number
): ColumnHead[] {
  return sources.map((source) => {
    if (source.kind === 'season') {
      return {
        code: 'last_season',
        chip: String(year - 1),
        chipTone: 'plain',
        name: 'Last season, posted',
        meta: source.last.label,
        option: null,
      }
    }
    const column = source.column
    if (column.code === 'rules') {
      const approved = column.approved_at ?? null
      const via = column.via ?? null
      const meta =
        approved === null ? '' : `approved ${day(approved)}${via === null ? '' : ` · from ${via}`}`
      return {
        code: 'rules',
        chip: 'Rules',
        chipTone: 'plain',
        name: column.label,
        meta,
        option: null,
      }
    }
    if (column.code === 'last_rules') {
      return {
        code: 'last_rules',
        chip: String(year - 1),
        chipTone: 'plain',
        name: "Last season's rules",
        meta: column.label,
        option: null,
      }
    }
    if (column.code === 'draft') {
      return {
        code: 'draft',
        chip: 'Draft',
        chipTone: 'draft',
        name: draftName,
        meta: 'your draft, not kept',
        option: null,
      }
    }
    const option = workspace.options.find((o) => o.code === column.code) ?? null
    const kept = option?.results
    const meta =
      option === null || kept === undefined
        ? ''
        : `kept ${day(option.kept_at)} · ${String(kept.requests)} application${kept.requests === 1 ? '' : 's'} · ${formatWholeMoney(kept.round1 + kept.round2)}`
    return {
      code: column.code,
      chip: column.code,
      chipTone: 'kept',
      name: option === null ? column.label : optionName(option),
      meta,
      option,
    }
  })
}

export interface CompareCell {
  readonly text: string
  readonly tone?: 'changed' | 'pool-negative' | 'total-negative' | 'muted'
  readonly sub?: string
  readonly note?: string
  readonly upDown?: { readonly up: number; readonly down: number }
}

export interface CompareRow {
  readonly kind: 'section' | 'row' | 'note'
  readonly label: string
  readonly bold?: boolean
  readonly indent?: boolean
  readonly muted?: boolean
  readonly cells: readonly CompareCell[]
}

const DASH: CompareCell = { text: '—' }
const SECTION_ORDER = Object.keys(SECTION_TITLES)

function valueAt(document: unknown, path: readonly string[]): unknown {
  let here = document
  for (const part of path) {
    if (Array.isArray(here)) here = here[Number(part)]
    else if (typeof here === 'object' && here !== null)
      here = (here as Record<string, unknown>)[part]
    else return undefined
  }
  return here
}

/** The vocabulary under a change's own section (`path[0]`): labelOf and formatSetting read section-relative paths, and
 * what a key names depends on its section (keyKind). */
const under = (path: readonly string[], names: RulesVocabulary): RulesNames | null => {
  const section = path[0] ?? ''
  return isRulesSection(section) ? { ...names, section } : null
}

/** A setting's label (disagreement 13): the section's card title, then each step of the rest of the path read under
 * that section, as the Rules tab's change lines read it (changeWords). */
function settingLabel(path: readonly string[], names: RulesVocabulary): string {
  const scoped = under(path, names)
  if (scoped === null) return path.join(' › ')
  const rest = path.slice(1)
  return [
    SECTION_TITLES[scoped.section],
    ...rest.map((_, i) => labelOf(rest.slice(0, i + 1), scoped)),
  ].join(' › ')
}

const isBand = (
  item: unknown
): item is { lower: string | number; upper?: string | number | null } =>
  typeof item === 'object' && item !== null && 'lower' in item

/**
 * A setting's figure in Scenarios' words (coordinator ruling 2026-10-07): money in whole dollars, and a list of income
 * bands as ranges ("$0 – $35,000, $35,001 and up", the Rules tier grid's words), where the shared formatSetting would
 * print cents and raw JSON. Everything else reads as formatSetting reads it, so the Rules tab is unchanged.
 */
export function settingWords(value: unknown, path: readonly string[], names?: RulesNames): string {
  if (path.at(-1) === 'bands' && Array.isArray(value) && value.length > 0 && value.every(isBand)) {
    return value
      .map((band) =>
        rangeWords(
          {
            lower: String(band.lower),
            upper: band.upper === null || band.upper === undefined ? null : String(band.upper),
          },
          formatWholeMoney
        )
      )
      .join(', ')
  }
  const n = Number(value)
  if (
    unitOf(path) === 'money' &&
    (typeof value === 'number' || (typeof value === 'string' && value !== '')) &&
    Number.isFinite(n)
  )
    return formatWholeMoney(n)
  return formatSetting(value, path, names)
}

const round1Differs = (column: ApiAidCompareColumn) =>
  column.changes.some((change) => ROUND1_SECTIONS.includes(String(change.path[0])))

function money(value: number | null | undefined, tone?: 'pool' | 'total'): CompareCell {
  if (value === null || value === undefined) return DASH
  const negative = toCents(value) < 0
  if (!negative || tone === undefined) return { text: formatWholeMoney(value) }
  return {
    text: formatWholeMoney(value),
    tone: tone === 'pool' ? 'pool-negative' : 'total-negative',
  }
}

/** The table's rows (§S5 H): settings that differ; spend, by pool; families; by tier when asked. */
export function compareRows(
  sources: readonly CompareSource[],
  options: {
    readonly byTier: boolean
    readonly locked: boolean
    readonly effectName: string
    readonly names: RulesVocabulary
  }
): CompareRow[] {
  const { byTier, locked, effectName, names } = options
  const priced = sources.flatMap((s) => (s.kind === 'priced' ? [s.column] : []))
  const rows: CompareRow[] = [
    { kind: 'section', label: `Settings that differ from ${effectName}`, cells: [] },
  ]

  const paths = new Map<string, readonly string[]>()
  for (const column of priced)
    for (const change of column.changes) paths.set(change.path.join('.'), change.path.map(String))
  const sorted = [...paths.values()].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a[0] ?? '') - SECTION_ORDER.indexOf(b[0] ?? '') ||
      a.join('.').localeCompare(b.join('.'))
  )
  if (sorted.length === 0)
    rows.push({ kind: 'note', label: "None: every column has the rules' settings.", cells: [] })
  for (const path of sorted) {
    const key = path.join('.')
    const scoped = under(path, names) ?? undefined
    rows.push({
      kind: 'row',
      label: settingLabel(path, names),
      cells: sources.map((s) => {
        if (s.kind === 'season') return DASH
        const text = settingWords(valueAt(s.column.document, path), path.slice(1), scoped)
        return s.column.changes.some((c) => c.path.join('.') === key)
          ? { text, tone: 'changed' }
          : { text }
      }),
    })
  }

  const pools = new Map<string, string>()
  for (const column of priced)
    for (const pool of column.results.pools) if (pool.pool !== '') pools.set(pool.pool, pool.label)
  const pooled = (s: CompareSource, key: string) =>
    s.kind === 'priced'
      ? s.column.results.pools.find((p) => p.pool === key)
      : (s.last.pools ?? []).find((p) => p.pool === key)

  rows.push({ kind: 'section', label: 'Spend, by pool', cells: [] })
  rows.push({
    kind: 'row',
    label: 'Round 1',
    bold: true,
    cells: sources.map((s) => {
      if (s.kind === 'season') return money(s.last.view?.round1)
      const cell = money(s.column.results.round1)
      return locked && round1Differs(s.column) ? { ...cell, note: 'posted Round 1 stands' } : cell
    }),
  })
  for (const [key, label] of pools)
    rows.push({
      kind: 'row',
      label,
      indent: true,
      cells: sources.map((s) => money(pooled(s, key)?.round1)),
    })
  rows.push({
    kind: 'row',
    label: locked ? 'Round 2, appeals keyed so far' : 'Round 2',
    cells: sources.map((s) =>
      s.kind === 'season'
        ? money(s.last.view?.round2)
        : locked
          ? money(s.column.results.round2)
          : { text: 'no appeals yet', tone: 'muted' }
    ),
  })
  rows.push({
    kind: 'row',
    label: 'Round 3',
    cells: sources.map((s) =>
      s.kind === 'season' ? money(s.last.round3 ?? 0) : { text: 'none yet', tone: 'muted' }
    ),
  })
  rows.push({
    kind: 'row',
    label: 'Remaining',
    bold: true,
    cells: sources.map((s) =>
      s.kind === 'season'
        ? money(s.last.remaining, 'total')
        : money(s.column.results.remaining, 'total')
    ),
  })
  for (const [key, label] of pools)
    rows.push({
      kind: 'row',
      label,
      indent: true,
      cells: sources.map((s) => money(pooled(s, key)?.remaining, 'pool')),
    })
  rows.push({
    kind: 'row',
    label: 'Projected season',
    muted: true,
    cells: sources.map((s) => {
      if (s.kind === 'season') return { text: '— its whole season' }
      const projection = s.column.results.projection ?? null
      if (projection === null) return DASH
      const left = projection.remaining ?? null
      return {
        text: `≈${roughly(locked ? projection.round1_and_2 : projection.round1)}`,
        ...(left === null ? {} : { sub: `Remaining ≈${roughly(left)}` }),
      }
    }),
  })

  rows.push({ kind: 'section', label: 'Families', cells: [] })
  rows.push({
    kind: 'row',
    label: 'Requests priced',
    cells: sources.map((s) => ({
      text: String(s.kind === 'season' ? (s.last.view?.requests ?? 0) : s.column.results.requests),
    })),
  })
  rows.push({
    kind: 'row',
    label: 'Average Round 1 per request',
    cells: sources.map((s) =>
      money(s.kind === 'season' ? s.last.view?.average_round1 : s.column.committee?.average_round1)
    ),
  })
  rows.push({
    kind: 'row',
    label: 'At the minimum',
    cells: sources.map((s) =>
      s.kind === 'season' ? DASH : { text: String(s.column.results.at_minimum) }
    ),
  })
  rows.push({
    kind: 'row',
    label: 'Held',
    cells: sources.map((s) =>
      s.kind === 'season' ? DASH : { text: String(s.column.results.held) }
    ),
  })
  rows.push({
    kind: 'row',
    label: `Requests up / down against ${effectName}`,
    cells: sources.map((s) =>
      s.kind === 'season' || s.column.up === null || s.column.down === null
        ? DASH
        : {
            text: `▲${String(s.column.up)} ▼${String(s.column.down)}`,
            upDown: { up: s.column.up, down: s.column.down },
          }
    ),
  })

  if (byTier) {
    const tierRows = (
      label: string,
      rowsOf: (
        s: CompareSource
      ) => ReadonlyArray<{ tier: number; amount: number; pct: number | null }>
    ) => {
      const tiers = [...new Set(sources.flatMap((s) => rowsOf(s).map((r) => r.tier)))].sort(
        (a, b) => a - b
      )
      rows.push({ kind: 'section', label, cells: [] })
      for (const tier of tiers) {
        rows.push({
          kind: 'row',
          label: `Tier ${String(tier)}`,
          cells: sources.map((s) => {
            const r = rowsOf(s).find((x) => x.tier === tier)
            if (r === undefined) return DASH
            return r.pct === null
              ? { text: formatWholeMoney(r.amount) }
              : { text: formatWholeMoney(r.amount), sub: `${String(r.pct)}% of ask` }
          }),
        })
      }
    }
    const committee = (s: CompareSource) =>
      (s.kind === 'season' ? s.last.view : s.column.committee) ?? null
    tierRows('Round 1 by tier, against what was asked', (s) =>
      (committee(s)?.round1_by_tier ?? [])
        .filter((r) => r.table === null)
        .map((r) => ({ tier: r.tier, amount: r.round1, pct: r.pct_of_ask }))
    )
    if (locked) {
      tierRows('Round 2 by tier, against what was asked', (s) =>
        (committee(s)?.round2_by_tier ?? [])
          .filter((r) => r.table === null)
          .map((r) => ({ tier: r.tier, amount: r.round2, pct: r.pct_of_ask }))
      )
    }
  }
  return rows
}

/** "Priced on ‹180› ‹the applications held | received through Feb 1 (the Round 1 deadline)›" (§S5 H). */
export function cornerWords(sources: readonly CompareSource[], requestSet: AidRequestSet): string {
  const first = sources.find((s) => s.kind === 'priced')
  const results = first?.kind === 'priced' ? first.column.results : null
  const through = results?.request_set?.through ?? null
  return `Priced on ${pricedOnWords(results?.requests ?? 0, requestSet, through)}`
}

/** The checked columns as the URL holds them (§S5 L): kept codes in `compare`, and `1` for each built-in. */
export function columnParams(checked: readonly ColumnKey[]): Record<string, string | null> {
  const codes = checked
    .filter((key) => key.startsWith('kept:'))
    .map((key) => key.slice('kept:'.length))
  const on = (key: ColumnKey) => (checked.includes(key) ? '1' : null)
  return {
    compare: codes.length === 0 ? null : codes.join(','),
    rules: on('rules'),
    lastrules: on('last_rules'),
    draft: on('draft'),
    last: on('last_season'),
  }
}

/**
 * After a keep (§S5 B): the new code joins the checked columns when Compare has columns and there is room (fewer
 * than four kept-or-draft); null when it doesn't join. `order` is Columns ▾'s, read before the new option arrives,
 * so the new code takes the kept options' last place, before last season.
 */
export function withNewKeep(
  checked: readonly ColumnKey[],
  code: string,
  order: readonly ColumnKey[]
): ColumnKey[] | null {
  const key: ColumnKey = `kept:${code}`
  if (checked.length === 0 || checked.includes(key)) return null
  const rest = order.filter((k) => k !== key && k !== 'last_season')
  const result = toggleColumn(checked, key, [...rest, key, 'last_season'])
  return result.refused === null ? result.checked : null
}
