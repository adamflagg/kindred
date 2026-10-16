/**
 * Sorting for the Analytics tables (#3207 PR 10, rulings #60-#61).
 *
 * A column is sorted by a value per row: a number, a string, or null/undefined when the row has
 * nothing to compare ("—" capacity, "not offered" last year). Empty values sit at the bottom in BOTH
 * directions, so a sort never buries real numbers under blanks. Ties keep the incoming order (the
 * table's natural order: start date, then name) whichever way the column runs, so the result is the
 * same stable order every time.
 */
export type SortValue = string | number | null | undefined

export type SortDir = 'asc' | 'desc'

function isEmpty(value: SortValue): value is null | undefined {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const aEmpty = isEmpty(a.v)
      const bEmpty = isEmpty(b.v)
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      if (!aEmpty && !bEmpty) {
        const c = compare(a.v as string | number, b.v as string | number)
        if (c !== 0) return c * sign
      }
      return a.index - b.index
    })
    .map((entry) => entry.row)
}
