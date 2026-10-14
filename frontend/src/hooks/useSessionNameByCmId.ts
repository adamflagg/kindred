/**
 * The newest name CampMinder has for a session cm_id (any year), used to carry
 * a stale ?session=<cm_id> onto the viewed year. Disabled until `enabled`.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

export function useSessionNameByCmId(cmId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sessionNameByCmId(cmId ?? 0),
    queryFn: async (): Promise<string | null> => {
      const res = await pb.collection('camp_sessions').getList(1, 1, {
        filter: `cm_id = ${cmId}`,
        sort: '-year',
      })
      return res.items[0]?.name ?? null
    },
    enabled: enabled && cmId !== null,
    ...syncDataOptions,
  })
}
