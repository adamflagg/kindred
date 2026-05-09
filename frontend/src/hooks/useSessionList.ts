import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'

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
  return useQuery<SessionListItem[]>({
    queryKey: queryKeys.allSessionsList(),
    queryFn: async () => {
      const result = await pb.collection('sessions').getFullList({ sort: 'cm_id' })
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
