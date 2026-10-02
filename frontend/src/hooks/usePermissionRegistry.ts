import { useQuery } from '@tanstack/react-query'
import type { ApiPermissionRegistry } from '../types/api-types'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

/**
 * The permission registry (code defaults: labels, areas, screens, wording).
 * Static per deploy, so it never goes stale; admin wording overrides are a
 * separate PocketBase read (usePermissionDescriptions).
 */
export function usePermissionRegistry() {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.permissionRegistry(),
    queryFn: async (): Promise<ApiPermissionRegistry> => {
      const res = await fetchWithAuth('/api/permissions')
      if (!res.ok) throw new Error(`Permission registry failed (${res.status})`)
      return (await res.json()) as ApiPermissionRegistry
    },
    staleTime: Infinity,
    enabled: !isAuthLoading,
  })
}
