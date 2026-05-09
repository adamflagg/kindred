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

export interface SessionListItem {
  id: string
  cm_id: number
  name: string
  year: number
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
      const result = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (session_type = "main" || session_type = "embedded")`,
        sort: 'start_date,cm_id',
      })
      return (result as unknown as RawSession[]).map((r) => ({
        id: r.id,
        cm_id: r.cm_id,
        name: r.name,
        year: r.year,
      }))
    },
  })
}
