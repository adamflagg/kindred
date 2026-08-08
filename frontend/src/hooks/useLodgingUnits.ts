/**
 * The Units query, shared by the units table, the aliases panel's unit
 * picker, and the unresolved-alias queue's mapping picker. Before
 * kindred#1896 each declared this inline, three times over.
 */
import { useQuery } from '@tanstack/react-query'

import { listLodgingUnits } from '../services/lodgingCrud'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useCurrentYear } from './useCurrentYear'

export function useLodgingUnits() {
  const { currentYear } = useCurrentYear()

  return useQuery({
    queryKey: queryKeys.lodgingUnits(currentYear),
    ...userDataOptions,
    queryFn: () => listLodgingUnits(currentYear),
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — without this gate a cold load renders a
    // false empty state.
    enabled: currentYear > 0,
  })
}
