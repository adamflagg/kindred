/**
 * Does a season have any countable summer attendee rows?
 *
 * Analytics swaps every page body for its empty state while the answer is no (PR 4,
 * decision 41): after the Oct 26 rollover the new season has no sign-ups for weeks, and
 * every page would otherwise draw zeros under it.
 *
 * "Countable" is deliberately not "enrolled". 2020 has no enrolled campers but over a
 * thousand cancelled summer rows, and a zero-enrolled gate would blank its real
 * Cancellations and Retention history. So the count keeps every status except 1 (none)
 * and 512 (incomplete).
 *
 * Session types: the summer camp types only. Family Camp and adult weekends never fold
 * into summer metrics. Teen programs (scit, tli) are left out because they can run
 * off-season under the same year (Feb, Sep and Oct sessions exist), and one early
 * off-season sign-up would retire the empty state while every summer page still reads 0.
 * No real season has teen rows without camp rows, so nothing countable is lost.
 *
 * The count ignores the session filter on purpose: the empty state is a season fact.
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

const SUMMER_CAMP_TYPES = ['main', 'embedded', 'ag', 'quest'] as const

export function seasonRowsFilter(year: number): string {
  const types = SUMMER_CAMP_TYPES.map((t) => `session.session_type = "${t}"`).join(' || ')
  return `year = ${year} && status_id != 1 && status_id != 512 && (${types})`
}

export interface SeasonRows {
  /** undefined while the count loads or when it failed, so a caller never flashes the empty state. */
  hasRows: boolean | undefined
  isLoading: boolean
  /** The count failed: the caller shows an error, never the page or the empty state. */
  error: Error | null
  refetch: () => void
}

export function useSeasonHasRows(year: number): SeasonRows {
  const { isLoading: authLoading } = useAuth()

  const query = useQuery({
    queryKey: queryKeys.metricsSeasonRows(year),
    queryFn: async () => {
      const res = await pb.collection('attendees').getList(1, 1, {
        fields: 'id',
        filter: seasonRowsFilter(year),
        skipTotal: false,
      })
      return res.totalItems > 0
    },
    enabled: year > 0 && !authLoading,
    // Attendees change with the nightly sync, like the session list beside it.
    ...syncDataOptions,
  })

  // Fail closed (ub:PR#3219:0, owner 2026-10-25): if the count errors, say so. Showing the pages would
  // put a normal-looking page over a check that never answered; the empty state would claim a season
  // is empty when it may not be.
  return {
    hasRows: query.isError ? undefined : query.data,
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    error: query.error,
    refetch: () => void query.refetch(),
  }
}
