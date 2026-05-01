import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  parseFilterFromSearchParams,
  serializeFilterToSearchParams,
  normalizeFilter,
  type FilterState,
  type FilterEdgeMode,
  type BunkSummary,
} from '../components/graph/graphFilter'

export interface UseGraphFilterResult {
  filter: FilterState
  isFilterActive: boolean
  addUnit: (unitName: string) => void
  removeUnit: (unitName: string) => void
  addBunk: (bunkCode: string) => void
  removeBunk: (bunkCode: string) => void
  setEdgeMode: (mode: FilterEdgeMode) => void
  clear: () => void
}

export function useGraphFilter(allBunks: BunkSummary[]): UseGraphFilterResult {
  const [searchParams, setSearchParams] = useSearchParams()

  const filter = useMemo(() => parseFilterFromSearchParams(searchParams), [searchParams])
  const isFilterActive = filter.units.length > 0 || filter.bunks.length > 0

  const writeFilter = useCallback(
    (next: FilterState) => {
      const normalized = normalizeFilter({ units: next.units, bunks: next.bunks }, allBunks)
      const final: FilterState = { ...normalized, edgeMode: next.edgeMode }
      const params = serializeFilterToSearchParams(final, searchParams)
      setSearchParams(params, { replace: false })
    },
    [allBunks, searchParams, setSearchParams]
  )

  const addUnit = useCallback(
    (unitName: string) => {
      if (filter.units.includes(unitName)) return
      writeFilter({ ...filter, units: [...filter.units, unitName] })
    },
    [filter, writeFilter]
  )

  const removeUnit = useCallback(
    (unitName: string) => {
      writeFilter({
        ...filter,
        units: filter.units.filter((u) => u !== unitName),
      })
    },
    [filter, writeFilter]
  )

  const addBunk = useCallback(
    (bunkCode: string) => {
      const code = bunkCode.toLowerCase()
      if (filter.bunks.includes(code)) return
      writeFilter({ ...filter, bunks: [...filter.bunks, code] })
    },
    [filter, writeFilter]
  )

  const removeBunk = useCallback(
    (bunkCode: string) => {
      const code = bunkCode.toLowerCase()
      writeFilter({
        ...filter,
        bunks: filter.bunks.filter((b) => b !== code),
      })
    },
    [filter, writeFilter]
  )

  const setEdgeMode = useCallback(
    (mode: FilterEdgeMode) => {
      writeFilter({ ...filter, edgeMode: mode })
    },
    [filter, writeFilter]
  )

  const clear = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('units')
    next.delete('bunks')
    next.delete('edges')
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  return { filter, isFilterActive, addUnit, removeUnit, addBunk, removeBunk, setEdgeMode, clear }
}
