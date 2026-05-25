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
import type { GenderScope } from '../components/graph/genderFilter'

export interface UseGraphFilterResult {
  filter: FilterState
  isFilterActive: boolean
  addUnit: (unitName: string) => void
  removeUnit: (unitName: string) => void
  addBunk: (bunkCode: string) => void
  removeBunk: (bunkCode: string) => void
  /** Replace the entire bunk selection atomically (used by gender/AG tab selector). */
  setBunks: (bunkCodes: string[]) => void
  setEdgeMode: (mode: FilterEdgeMode) => void
  /** Set the active gender scope. Non-'all' clears manual unit/bunk selection. */
  setGender: (scope: GenderScope) => void
  clear: () => void
}

export function useGraphFilter(allBunks: BunkSummary[]): UseGraphFilterResult {
  const [searchParams, setSearchParams] = useSearchParams()

  const filter = useMemo(() => parseFilterFromSearchParams(searchParams), [searchParams])
  const isFilterActive = filter.units.length > 0 || filter.bunks.length > 0

  const writeFilter = useCallback(
    (next: FilterState) => {
      const normalized = normalizeFilter({ units: next.units, bunks: next.bunks }, allBunks)
      const final: FilterState = { ...normalized, gender: next.gender, edgeMode: next.edgeMode }
      setSearchParams((prev) => serializeFilterToSearchParams(final, prev), { replace: false })
    },
    [allBunks, setSearchParams]
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

  const setBunks = useCallback(
    (bunkCodes: string[]) => {
      writeFilter({
        ...filter,
        units: [],
        gender: 'all',
        bunks: bunkCodes.map((c) => c.toLowerCase()),
      })
    },
    [filter, writeFilter]
  )

  const setGender = useCallback(
    (scope: GenderScope) => {
      // Gender scope is exclusive of manual unit/bunk selection.
      writeFilter({ units: [], bunks: [], gender: scope, edgeMode: filter.edgeMode })
    },
    [filter.edgeMode, writeFilter]
  )

  const setEdgeMode = useCallback(
    (mode: FilterEdgeMode) => {
      writeFilter({ ...filter, edgeMode: mode })
    },
    [filter, writeFilter]
  )

  const clear = useCallback(() => {
    setSearchParams(
      (prev) =>
        serializeFilterToSearchParams(
          { units: [], bunks: [], gender: 'all', edgeMode: 'strict' },
          prev
        ),
      { replace: false }
    )
  }, [setSearchParams])

  return {
    filter,
    isFilterActive,
    addUnit,
    removeUnit,
    addBunk,
    removeBunk,
    setBunks,
    setEdgeMode,
    setGender,
    clear,
  }
}
