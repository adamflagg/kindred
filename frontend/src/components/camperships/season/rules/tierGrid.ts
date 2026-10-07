/** The combined tier grid and the tiers editor's arithmetic (spec §6.2 E.2; owner Q6: start + width + count). Pure. */
import { formatMoney } from '../../kit/money'

export interface Band {
  readonly lower: string
  readonly upper: string | null
}

/** Even bands from a start, a width and a count; tier n (n ≥ 2) starts at start + width × (n−1) + 1. */
export function bandsOf(start: number, width: number, count: number): Band[] {
  return Array.from({ length: count }, (_, i) => ({
    lower: String(i === 0 ? start : start + i * width + 1),
    upper: i === count - 1 ? null : String(start + (i + 1) * width),
  }))
}

const plain = (band: Band): Band => ({
  lower: String(Number(band.lower)),
  upper: band.upper === null ? null : String(Number(band.upper)),
})

export function evenOf(
  bands: readonly Band[]
): { start: number; width: number; count: number } | null {
  const first = bands[0]
  if (bands.length < 3 || !first?.upper) return null
  const start = Number(first.lower)
  const width = Number(first.upper) - start
  const even = bandsOf(start, width, bands.length)
  return JSON.stringify(even) === JSON.stringify(bands.map(plain))
    ? { start, width, count: bands.length }
    : null
}

/** "$0 – $40,000", "$70,001 and up". `money` words each end (Scenarios passes its whole dollars). */
export const rangeWords = (band: Band, money: (value: number) => string = formatMoney) =>
  band.upper === null
    ? `${money(Number(band.lower))} and up`
    : `${money(Number(band.lower))} – ${money(Number(band.upper))}`

export function tierLineWords(bands: readonly Band[], ceiling: string | null): string {
  const even = evenOf(bands)
  const lead = even
    ? `${formatMoney(even.width)} bands from ${formatMoney(even.start)}`
    : `Bands set by hand from ${formatMoney(Number(bands[0]?.lower ?? 0))}`
  const top =
    ceiling === null ? 'no income ceiling' : `income ceiling ${formatMoney(Number(ceiling))}`
  return `${lead} · ${String(bands.length)} tiers · ${top}`
}

/** What a changed tier count does on save (the mock's words; §9.9: fewer trims both tables, more adds empty rows). */
export function countNote(was: number, now: number): string | null {
  if (now === was) return null
  const range = (a: number, b: number) =>
    a === b ? `tier ${String(a)}` : `tiers ${String(a)}–${String(b)}`
  if (now > was) {
    const several = now - was > 1
    return `Saving adds ${range(was + 1, now)} to the Round 1 and appeal tables, empty: fill ${several ? 'them' : 'it'} in before approving.`
  }
  return `Saving drops ${range(now + 1, was)} from the Round 1 and appeal tables.`
}

export interface TableShape {
  readonly inherits?: string | null
  readonly tiers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export interface GridColumn {
  readonly table: string
  readonly label: string
  readonly caption: string
}

/** The grid's columns follow the award tables' keys, which are the equity classes (owner 10-06: 1:1). */
export function gridColumns(
  tables: Readonly<Record<string, TableShape>>,
  classes: readonly string[],
  label: (key: string) => string
): GridColumn[] {
  return classes
    .filter((key) => key in tables)
    .map((key) => {
      const table = tables[key]
      const parent = table?.inherits ?? null
      const changed = Object.keys(table?.overrides ?? {}).length > 0
      return {
        table: key,
        label: label(key),
        caption:
          parent === null
            ? 'its own'
            : `same as ${label(parent)}${changed ? ', with changes' : ''}`,
      }
    })
}

export function gridCell(
  tables: Readonly<Record<string, TableShape>>,
  table: string,
  tier: number,
  key: 'r1_pct' | 'total_pct'
): { value: string | null; inherited: boolean } {
  const t = tables[table]
  const at = String(tier)
  const own = t?.tiers?.[at]?.[key] ?? t?.overrides?.[at]?.[key]
  if (own !== undefined && own !== null) return { value: String(own), inherited: false }
  const parent = t?.inherits ? tables[t.inherits]?.tiers?.[at]?.[key] : undefined
  return parent === undefined || parent === null
    ? { value: null, inherited: false }
    : { value: String(parent), inherited: true }
}

/**
 * Where a cell's own figure lives inside its table (`tiers.<n>.<key>`, else `overrides.<n>.<key>`), or null for an
 * inherited or empty cell: only a cell that holds a figure of its own can be typed into.
 */
export function cellPath(
  tables: Readonly<Record<string, TableShape>>,
  table: string,
  tier: number,
  key: 'r1_pct' | 'total_pct'
): string[] | null {
  const t = tables[table]
  const at = String(tier)
  if (t?.tiers?.[at]?.[key] != null) return [table, 'tiers', at, key]
  if (t?.overrides?.[at]?.[key] != null) return [table, 'overrides', at, key]
  return null
}

/** A document's bands as the grid reads them: decimals as strings, a missing upper the open top band. */
export function bandsIn(tiers: {
  readonly bands: ReadonlyArray<{
    readonly lower: string | number
    readonly upper?: string | number | null
  }>
}): Band[] {
  return tiers.bands.map((b) => ({
    lower: String(b.lower),
    upper: b.upper === null || b.upper === undefined ? null : String(b.upper),
  }))
}

/** The table a table copies (`inherits`), or null for one that holds its own figures. */
function parentOf(table: unknown): string | null {
  if (typeof table !== 'object' || table === null || !('inherits' in table)) return null
  return typeof table.inherits === 'string' ? table.inherits : null
}

/**
 * The grid's classes (§6.2 E.2): the award tables' keys in the programs' equity-class order, then any other table;
 * a table another copies comes first, so "its own" stands before the columns that say "same as" it (coordinator B6).
 */
export function gridClasses(
  programs: Readonly<Record<string, { readonly equity_class?: string | null }>>,
  tables: Readonly<Record<string, unknown>>
): string[] {
  const ordered: string[] = []
  for (const program of Object.values(programs)) {
    const cls = program.equity_class
    if (typeof cls === 'string' && cls in tables && !ordered.includes(cls)) ordered.push(cls)
  }
  const all = [...ordered, ...Object.keys(tables).filter((key) => !ordered.includes(key))]
  const sources = new Set(Object.values(tables).map(parentOf))
  return [...all.filter((key) => sources.has(key)), ...all.filter((key) => !sources.has(key))]
}

/** The Round 1 cells a `value_cannot_bind` warning names (validation.py: `award_tables.<table>.tiers.<tier>`), as "table:tier". */
export function warnedCells(
  issues: ReadonlyArray<{ readonly code: string; readonly path: string }>
): Set<string> {
  const out = new Set<string>()
  for (const issue of issues) {
    const match = /^award_tables\.([^.]+)\.tiers\.(\d+)$/.exec(issue.path)
    if (issue.code === 'value_cannot_bind' && match !== null)
      out.add(`${match[1] ?? ''}:${match[2] ?? ''}`)
  }
  return out
}
