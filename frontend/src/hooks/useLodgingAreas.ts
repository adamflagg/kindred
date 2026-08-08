/**
 * The Areas query, shared by the areas drawer (the editor itself) and the
 * units table (which groups by area). Before kindred#1896 each declared this
 * inline, with its own `?? []` coercion.
 */
import { useQuery } from '@tanstack/react-query'

import { listLodgingAreas } from '../services/lodgingCrud'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useCurrentYear } from './useCurrentYear'

export interface UseLodgingAreasOptions {
  /**
   * ANDed with year-readiness, not a replacement for it. Defaults to true —
   * most consumers always want the query; the areas drawer passes `open` so
   * it does not fetch while closed.
   */
  enabled?: boolean
}

export function useLodgingAreas({ enabled = true }: UseLodgingAreasOptions = {}) {
  const { currentYear } = useCurrentYear()

  return useQuery({
    queryKey: queryKeys.lodgingAreas(currentYear),
    ...userDataOptions,
    queryFn: () => listLodgingAreas(currentYear),
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — so `currentYear > 0` gates the fetch
    // regardless of what the caller passes for `enabled`.
    enabled: enabled && currentYear > 0,
  })
}
