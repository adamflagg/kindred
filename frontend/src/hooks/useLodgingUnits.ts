/**
 * The Units query, shared by the units table, the aliases panel's unit
 * picker, and the unresolved-alias queue's mapping picker. Before
 * kindred#1896 each declared this inline, three times over, each with its
 * own `?? []` coercion — callers now read `.items` instead of `.data ?? []`,
 * so that coercion lives here once.
 */
import { useQuery } from '@tanstack/react-query'

import { listLodgingUnits } from '../services/lodgingCrud'
import type { LodgingUnitRecord } from '../types/lodging'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useYear } from './useCurrentYear'

export interface UseLodgingUnitsResult {
  data: LodgingUnitRecord[] | undefined
  /** `.data ?? []` — the coercion every call site used to do for itself. */
  items: LodgingUnitRecord[]
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
}

export function useLodgingUnits(): UseLodgingUnitsResult {
  const currentYear = useYear()

  const query = useQuery({
    queryKey: queryKeys.lodgingUnits(currentYear),
    ...userDataOptions,
    queryFn: () => listLodgingUnits(currentYear),
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — without this gate a cold load renders a
    // false empty state.
    enabled: currentYear > 0,
  })

  return {
    data: query.data,
    items: query.data ?? [],
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: query.error,
  }
}
