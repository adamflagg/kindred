/**
 * The table primitive's logic (§4.3; D18, D23–D25, D27, D31): sort, search, group, the matched
 * id and the ↑/↓ step. Pure, so the component only renders. The server already decided every row
 * (D21); the browser only filters and sorts what it was given.
 */

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export type CellValue = string | number | null
export type SortDir = 'asc' | 'desc'

export interface SortState {
  readonly key: string
  readonly dir: SortDir
}

/** The URL's "key:dir" (D15). An unknown column is no sort. */
export function parseSort(raw: string | null, keys: readonly string[]): SortState | null {
  if (!raw) return null
  const [key, dir] = raw.split(':')
  if (key === undefined || !keys.includes(key)) return null
  return { key, dir: dir === 'desc' ? 'desc' : 'asc' }
}

export function formatSort(sort: SortState): string {
  return `${sort.key}:${sort.dir}`
}

/** A header click: ascending first, then descending, then ascending again. */
export function nextSort(current: SortState | null, key: string): SortState {
  return current?.key === key && current.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' }
}

const isEmpty = (value: CellValue) => value === null || value === ''

/** Stable. "Nothing there" ("—", D74) sorts last whichever way: it isn't a value. */
export function sortRows<Row>(
  rows: readonly Row[],
  value: (row: Row) => CellValue,
  dir: SortDir
): Row[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const aEmpty = isEmpty(a.v)
      const bEmpty = isEmpty(b.v)
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1
      const order =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : COLLATOR.compare(String(a.v), String(b.v))
      return order !== 0 ? sign * order : a.index - b.index
    })
    .map((entry) => entry.row)
}

/** Lower-cased with accents dropped, so "jose" finds "José" (and the other way round). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Every term must appear in some field, ignoring case and accents: names and CampMinder ids alike (D27). */
export function matchesSearch(
  fields: ReadonlyArray<string | number | null>,
  query: string
): boolean {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = fields
    .filter((f): f is string | number => f !== null)
    .map((f) => fold(String(f)))
  return terms.every((term) => haystack.some((field) => field.includes(term)))
}

/**
 * D27: CampMinder ids cost no column. When an all-digit search term found one of a row's ids, the
 * grid shows that id as a highlighted chip under the name. Null when the search matched on a name.
 */
export function matchedId(ids: readonly number[], query: string): number | null {
  const terms = fold(query.trim())
    .split(/\s+/)
    .filter((term) => /^\d+$/.test(term))
  if (terms.length === 0) return null
  return ids.find((id) => terms.some((term) => String(id).includes(term))) ?? null
}

export interface RowGroup<Row> {
  readonly id: string
  readonly heading: string
  readonly rows: Row[]
}

/**
 * Groups keep the order their first row appears in, so a sorted table still reads top to bottom;
 * with an `order` of group ids, those come first in that order (By reason's strip stages, owner
 * rulings 10-04 late) and any group it does not name follows in first-row order.
 */
export function groupRows<Row>(
  rows: readonly Row[],
  groupOf: (row: Row) => { id: string; heading: string },
  order?: readonly string[]
): Array<RowGroup<Row>> {
  const groups = new Map<string, RowGroup<Row>>()
  for (const row of rows) {
    const { id, heading } = groupOf(row)
    const existing = groups.get(id)
    if (existing) existing.rows.push(row)
    else groups.set(id, { id, heading, rows: [row] })
  }
  const found = [...groups.values()]
  if (order === undefined) return found
  const rank = (group: RowGroup<Row>) => {
    const at = order.indexOf(group.id)
    return at === -1 ? order.length : at
  }
  // Array sort is stable, so the unnamed groups keep their first-row order among themselves.
  return found.sort((a, b) => rank(a) - rank(b))
}

/** ↑/↓ (D13, D31): from nothing, ↓ takes the first row and ↑ the last; the ends hold. */
export function stepHighlight(
  order: readonly string[],
  current: string | null,
  step: 1 | -1
): string | null {
  if (order.length === 0) return null
  const at = current === null ? -1 : order.indexOf(current)
  if (at === -1) return (step === 1 ? order[0] : order[order.length - 1]) ?? null
  return order[Math.min(order.length - 1, Math.max(0, at + step))] ?? null
}

/** A column sized to its content: the widest piece, rounded up, plus padding, never under the floor. */
export interface FitContent {
  readonly pad: number
  readonly min: number
  /** A cap: a longer content cuts (with its title) instead of widening the column. A `min` above it wins. */
  readonly max?: number
}

/**
 * Needs attention's width (batch 4, grid-layout-options.html round 6): the widest chip on screen
 * plus 18px, never under 84px. Pure, so the rule is held apart from the DOM that measures it.
 */
export function fitColumnWidth(widths: readonly number[], fit: FitContent): number {
  const widest = widths.reduce((max, width) => Math.max(max, width), 0)
  const fitted = Math.ceil(widest) + fit.pad
  return Math.max(fit.min, fit.max === undefined ? fitted : Math.min(fit.max, fitted))
}

/** A text measurer (px, or null when nothing can measure: jsdom has no canvas). */
export type TextMeasurer = (text: string) => number | null

/**
 * A money column fits its footer total (ux3 requests-10): never under its spec width, else the
 * total's measured width, rounded up, plus `pad` (the cell's 16px). The measurer is injected so the
 * rule stays apart from the canvas that draws it.
 */
export function moneyColumnWidth(
  spec: number,
  totalText: string,
  measure: TextMeasurer,
  pad = 16
): number {
  const width = measure(totalText)
  return width === null ? spec : Math.max(spec, Math.ceil(width) + pad)
}

/** Measures with a canvas set to `font` (a CSS font shorthand); null where there is no 2d canvas. */
export function canvasMeasurer(font: string): TextMeasurer {
  let context: CanvasRenderingContext2D | null | undefined
  return (text) => {
    if (context === undefined) {
      try {
        context = document.createElement('canvas').getContext('2d')
        if (context !== null) context.font = font
      } catch {
        context = null
      }
    }
    return context ? context.measureText(text).width : null
  }
}
