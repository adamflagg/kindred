import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { sortSessionsByDate } from '../utils/sessionUtils'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useAuth } from '../contexts/AuthContext'

const SUMMER_TYPES = ['main', 'embedded', 'ag', 'quest']

export function useAdminSessions(year: number) {
  const { isLoading } = useAuth()

  return useQuery({
    queryKey: queryKeys.adminSessions(year),
    queryFn: async () => {
      const typeFilter = SUMMER_TYPES.map((t) => `session_type = "${t}"`).join(' || ')
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (${typeFilter})`,
        sort: 'start_date',
      })
      return sortSessionsByDate(sessions)
    },
    enabled: year > 0 && !isLoading,
    ...userDataOptions,
  })
}
