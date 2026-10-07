import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import { queryKeys } from '../../utils/queryKeys'

export interface CatalogSession {
  readonly cmId: number
  readonly name: string
  readonly startDate: string
  readonly sortOrder: number
  readonly type: string
  readonly parentId: number
}

interface Row {
  cm_id: number
  name: string
  start_date: string
  sort_order: number | null
  session_type: string
  parent_id: number | null
}

function useCatalogQuery(year: number) {
  const { isLoading } = useAuth()
  return useQuery({
    queryKey: queryKeys.campSessionCatalog(year),
    queryFn: async () => {
      const rows = await pb.collection('camp_sessions').getFullList<Row>({
        filter: `year = ${String(year)}`,
        fields: 'cm_id,name,start_date,sort_order,session_type,parent_id',
        sort: 'start_date,sort_order,cm_id',
      })
      return rows.map((r): CatalogSession => ({
        cmId: r.cm_id,
        name: r.name,
        startDate: r.start_date,
        sortOrder: r.sort_order ?? 0,
        type: r.session_type,
        parentId: r.parent_id ?? 0,
      }))
    },
    enabled: year > 0 && !isLoading,
  })
}

/**
 * The season's sessions as the Programs and costs card lays them out (spec §5.3): type for the sub-sections and the
 * per-person default, parent for AG sessions, date then CampMinder's order. Read like `useAidSessionNames` (any
 * signed-in user may list camp_sessions); inherits the app's cache defaults for the same reason (sessions change only
 * on a sync, and `camp-sessions` is a sync-dependent prefix).
 */
export function useAidSessionCatalog(year: number): readonly CatalogSession[] | undefined {
  return useCatalogQuery(year).data
}

/** Why the catalog read failed (null while it loads or after it succeeds): the card says so instead of loading for ever. Same query, same cache. */
export function useAidSessionCatalogError(year: number): Error | null {
  return useCatalogQuery(year).error
}
