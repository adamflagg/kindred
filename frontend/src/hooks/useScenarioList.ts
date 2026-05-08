import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'

interface RawScenario {
  id: string
  name: string
  session_cm_id?: number
  session_id?: number
}

export interface ScenarioListItem {
  id: string
  name: string
  session_id: number
}

export function useScenarioList() {
  return useQuery<ScenarioListItem[]>({
    queryKey: ['scenarios', 'list'],
    queryFn: async () => {
      const result = await pb.collection('saved_scenarios').getFullList()
      return (result as unknown as RawScenario[]).map((r) => ({
        id: r.id,
        name: r.name,
        session_id: r.session_cm_id ?? r.session_id ?? 0,
      }))
    },
  })
}
