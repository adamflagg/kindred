import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { sortSessionsByDate } from '../utils/sessionUtils'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useAuth } from '../contexts/AuthContext'
import {
  SUMMER_CAMP_TYPES,
  TEEN_PROGRAM_TYPES,
  getSummerWindow,
  isSummerTeenSession,
  isTeenProgram,
} from '../utils/sessionTypePredicates'

// Camp + quest + teen programs. Teens are window-gated below so off-season
// scit/tli (fall Family-Camp CIT, year-round Teen Interns) never reach the table.
const ADMIN_SESSION_TYPES = [...SUMMER_CAMP_TYPES, ...TEEN_PROGRAM_TYPES] as const

export function useAdminSessions(year: number) {
  const { isLoading } = useAuth()

  return useQuery({
    queryKey: queryKeys.adminSessions(year),
    queryFn: async () => {
      const typeFilter = ADMIN_SESSION_TYPES.map((t) => `session_type = "${t}"`).join(' || ')
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (${typeFilter})`,
        sort: 'start_date',
      })
      const summerWindow = getSummerWindow(sessions)
      const gated = sessions.filter(
        (s) =>
          !isTeenProgram(s as { session_type?: string | null }) ||
          isSummerTeenSession(
            s as { session_type?: string | null; start_date?: string; end_date?: string },
            summerWindow
          )
      )
      return sortSessionsByDate(gated)
    },
    enabled: year > 0 && !isLoading,
    ...userDataOptions,
  })
}
