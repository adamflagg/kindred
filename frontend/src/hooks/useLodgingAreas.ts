/**
 * The Areas query, shared by the areas drawer (the editor itself) and the
 * units table (which groups by area). Before kindred#1896 each declared this
 * inline, with its own `?? []` coercion — callers now read `.items` instead
 * of `.data ?? []`, so that coercion lives here once.
 */
import { useQuery } from '@tanstack/react-query'

import { listLodgingAreas } from '../services/lodgingCrud'
import type { LodgingAreaRecord } from '../types/lodging'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useYear } from './useCurrentYear'

export interface UseLodgingAreasResult {
  /**
   * `undefined` until the query settles, exactly like the raw TanStack
   * result — deliberately NOT coerced. If a future caller passes this to
   * `QueryGuard` (see `useLodgingUnits.ts`'s twin warning — its `data` feeds
   * `LodgingUnitsPanel.tsx`'s `QueryGuard` today), that component's
   * empty-vs-loading branch keys on `!data`; coercing it here would make
   * that check always false. Use `.items` below at render sites, never here.
   */
  data: LodgingAreaRecord[] | undefined
  /** `.data ?? []` — the coercion every call site used to do for itself. */
  items: LodgingAreaRecord[]
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
}

export function useLodgingAreas(): UseLodgingAreasResult {
  const currentYear = useYear()

  const query = useQuery({
    queryKey: queryKeys.lodgingAreas(currentYear),
    ...userDataOptions,
    queryFn: () => listLodgingAreas(currentYear),
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — so this gates the fetch regardless of
    // whether a consumer is currently visible.
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
