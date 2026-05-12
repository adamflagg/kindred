import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import { useYear } from './useCurrentYear'

interface RawSession {
  id: string
  cm_id: number
  name: string
  year: number
}

interface RawAttendee {
  session: string // PB record id of camp_sessions, NOT cm_id
}

export interface SessionListItem {
  id: string
  cm_id: number
  name: string
  year: number
  attendee_count: number
}

// The solver session list mirrors the bunking board's SessionList — only main +
// embedded sessions, sorted by start_date then cm_id. AG sessions roll up into
// their parent main session at solve time (the solver fetches the parent and
// pulls its AG children via parent_id), so AG entries don't need their own row.
export function useSessionList() {
  const year = useYear()
  return useQuery<SessionListItem[]>({
    queryKey: queryKeys.allSessionsList(year),
    queryFn: async () => {
      const [sessions, attendees] = await Promise.all([
        pb.collection('camp_sessions').getFullList({
          filter: `year = ${year} && (session_type = "main" || session_type = "embedded")`,
          sort: 'start_date,cm_id',
        }),
        pb.collection('attendees').getFullList({
          filter: `year = ${year} && status_id = 2`,
          fields: 'session', // minimize payload
        }),
      ])
      const countsBySession = (attendees as unknown as RawAttendee[]).reduce<
        Record<string, number>
      >((acc, a) => {
        acc[a.session] = (acc[a.session] ?? 0) + 1
        return acc
      }, {})
      return (sessions as unknown as RawSession[]).map((r) => ({
        id: r.id,
        cm_id: r.cm_id,
        name: r.name,
        year: r.year,
        attendee_count: countsBySession[r.id] ?? 0,
      }))
    },
  })
}
