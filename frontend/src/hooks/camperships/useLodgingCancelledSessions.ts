import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import { queryKeys } from '../../utils/queryKeys'

/**
 * The weekends the lodging board marked cancelled this season (`lodging_session_status`, migration 1500000142:
 * `session_cm_id`, `year`, `status` select active/cancelled; a missing row means running). CampMinder keeps such
 * sessions `is_active = 1`, so this staff-owned flag is the only signal (owner 10-07, open item 7). It drives a muted
 * "cancelled on the lodging board" tag only, never a pre-checked Not running. Any signed-in user may list it.
 * App cache defaults; `WeekendStatusPanel`'s write invalidates the `weekend-sessions` prefix this key sits under.
 * #3048 is where this, `is_active` and the rules' not-running list become one per-season record.
 */
export function useLodgingCancelledSessions(year: number): ReadonlySet<number> | undefined {
  const { isLoading } = useAuth()
  return useQuery({
    queryKey: queryKeys.weekendSessionsCancelled(year),
    queryFn: async () => {
      const rows = await pb
        .collection('lodging_session_status')
        .getFullList<{ session_cm_id: number }>({
          filter: `year = ${String(year)} && status = "cancelled"`,
          fields: 'session_cm_id',
        })
      return new Set(rows.map((r) => r.session_cm_id))
    },
    enabled: year > 0 && !isLoading,
  }).data
}
