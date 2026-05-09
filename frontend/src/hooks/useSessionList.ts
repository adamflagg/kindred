import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import { SUMMER_CAMP_TYPES } from '../utils/sessionTypePredicates'
import { useYear } from './useCurrentYear'

interface RawSession {
  id: string
  cm_id: number
  session_name: string
  year: number
  attendee_count?: number
}

export interface SessionListItem {
  id: string
  cm_id: number
  session_name: string
  year: number
  attendee_count: number
}

export function useSessionList() {
  const year = useYear()
  return useQuery<SessionListItem[]>({
    queryKey: queryKeys.allSessionsList(year),
    queryFn: async () => {
      const typeFilter = SUMMER_CAMP_TYPES.map((t) => `session_type = "${t}"`).join(' || ')
      const result = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (${typeFilter})`,
        sort: 'cm_id',
      })
      return (result as unknown as RawSession[]).map((r) => ({
        id: r.id,
        cm_id: r.cm_id,
        session_name: r.session_name,
        year: r.year,
        attendee_count: r.attendee_count ?? 0,
      }))
    },
  })
}
