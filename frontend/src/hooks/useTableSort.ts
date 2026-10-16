import { useState } from 'react'
import type { SortDirection } from '../components/ui/SortableColumnHeader'
import { sortRows, type SortDir, type SortValue } from '../utils/tableSort'

/**
 * Click-to-sort state for an Analytics table (#3207 PR 10, ruling #60): a click flips up and down, the
 * first click on a number column goes high to low and on a text column A to Z, and there is no third
 * "unsorted" step. Until the first click the table keeps its natural order and the `leadField` header
 * shows the default arrow.
 */
export function useTableSort<K extends string>(
  leadField: K,
  textFields: readonly K[] = [leadField]
) {
  const [state, setState] = useState<{ field: K; dir: SortDir } | null>(null)

  const toggle = (field: K) =>
    setState((prev) =>
      prev?.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: textFields.includes(field) ? 'asc' : 'desc' }
    )

  const direction = (field: K): SortDirection | null => {
    if (state === null) return field === leadField ? 'ascending' : null
    if (state.field !== field) return null
    return state.dir === 'asc' ? 'ascending' : 'descending'
  }

  /** The rows in the chosen order; `value` reads the active column off a row. */
  const apply = <T>(rows: readonly T[], value: (row: T, field: K) => SortValue): T[] =>
    state === null ? [...rows] : sortRows(rows, (row) => value(row, state.field), state.dir)

  return { toggle, direction, apply, active: state }
}
