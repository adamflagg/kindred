import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { formatSort, nextSort, parseSort, type SortState } from './table'

const FLAT = 'flat'

/**
 * Sort and grouping live in the URL (D15, §3.6), so a pasted link reproduces the view. A
 * queue view opens grouped by reason (D24); choosing flat there is remembered as `group=flat`.
 * `prefix` keeps two tables on one page apart. URL updates replace, so Back leaves the page
 * rather than undoing a sort.
 */
export function useAidTableUrl(
  columnKeys: readonly string[],
  groupingKeys: readonly string[],
  prefix = '',
  defaultGrouping?: string
): {
  sort: SortState | null
  group: string | null
  toggleSort: (key: string) => void
  setGroup: (key: string | null) => void
} {
  const [params, setParams] = useSearchParams()
  const sortParam = `${prefix}sort`
  const groupParam = `${prefix}group`
  const sort = parseSort(params.get(sortParam), columnKeys)
  const raw = params.get(groupParam)
  const group =
    raw === FLAT
      ? null
      : raw !== null && groupingKeys.includes(raw)
        ? raw
        : (defaultGrouping ?? null)

  const update = useCallback(
    (name: string, value: string | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (value === null) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  return {
    sort,
    group,
    toggleSort: (key) => update(sortParam, formatSort(nextSort(sort, key))),
    setGroup: (key) => update(groupParam, key ?? (defaultGrouping !== undefined ? FLAT : null)),
  }
}
