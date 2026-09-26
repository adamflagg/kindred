import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import type { Role } from '../types/rbac'

/** Every RBAC role, sorted by name. Shared by the Users page and the View-as switcher. */
export function useRoles({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.roles(),
    queryFn: () => pb.collection('roles').getFullList<Role>({ sort: 'name', requestKey: null }),
    ...userDataOptions,
    enabled,
  })
}
