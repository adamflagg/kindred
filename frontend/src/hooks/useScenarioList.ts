import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import { useYear } from './useCurrentYear'

interface RawScenario {
  id: string
  name: string
  expand?: { session?: { cm_id?: number } }
}

export interface ScenarioListItem {
  id: string
  name: string
  /** CampMinder session id resolved via the expanded `session` relation. */
  session_id: number
}

export function useScenarioList() {
  const year = useYear()
  return useQuery<ScenarioListItem[]>({
    queryKey: queryKeys.scenariosList(year),
    queryFn: async () => {
      const result = await pb.collection('saved_scenarios').getFullList({
        filter: `year = ${year}`,
        expand: 'session',
        sort: 'name',
      })
      return (result as unknown as RawScenario[]).map((r) => ({
        id: r.id,
        name: r.name,
        session_id: r.expand?.session?.cm_id ?? 0,
      }))
    },
  })
}
