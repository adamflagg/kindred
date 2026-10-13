import { useQuery } from '@tanstack/react-query'
import type { ApiVersion } from '../types/api-types'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import { newestVersion } from '../utils/versionParser'
import { useApiWithAuth } from './useApiWithAuth'

export interface DeployedVersions {
  /** The frontend's own baked version (VITE_APP_VERSION), or "dev". */
  frontend: string
  /** The api image's version; undefined while loading or when it failed. */
  api?: string | undefined
  /** The PocketBase image's version; undefined while loading or when it failed. */
  pocketbase?: string | undefined
  /** The newest of the three, falling back to the frontend's. */
  newest: string
}

function versionField(body: unknown, field: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[field]
  return typeof value === 'string' && value !== '' ? value : null
}

// A version is fixed for the life of the deploy: read it once per session.
// Stale never, kept for the session, and no refetch on focus or reconnect.
const ONCE_PER_SESSION = {
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

/**
 * The version each Kindred component was built at. CD rebuilds only the images
 * whose files changed and retags the rest, so after an api-only release the
 * frontend's baked version is older than the api's. Each server reports its
 * own; `newest` is what the Help menu shows, and feedback sends all three.
 * On failure or while loading, a server's version is undefined and `newest`
 * falls back to the frontend's, so the row never disappears.
 */
export function useDeployedVersions(): DeployedVersions {
  const { fetchWithAuth, isAuthenticated, isAuthLoading } = useApiWithAuth()
  const enabled = isAuthenticated && !isAuthLoading
  const frontend = import.meta.env.VITE_APP_VERSION || 'dev'

  const api = useQuery({
    queryKey: queryKeys.deployedVersion('api'),
    queryFn: async (): Promise<string | null> => {
      const res = await fetchWithAuth('/api/version')
      if (!res.ok) throw new Error(`Version request failed (${res.status})`)
      return versionField((await res.json()) as ApiVersion, 'api')
    },
    enabled,
    ...ONCE_PER_SESSION,
  })

  const pocketbase = useQuery({
    queryKey: queryKeys.deployedVersion('pocketbase'),
    queryFn: async (): Promise<string | null> =>
      versionField(await pb.send('/api/custom/version', { method: 'GET' }), 'pocketbase'),
    enabled,
    ...ONCE_PER_SESSION,
  })

  const apiVersion = api.data ?? undefined
  const pocketbaseVersion = pocketbase.data ?? undefined
  return {
    frontend,
    api: apiVersion,
    pocketbase: pocketbaseVersion,
    newest: newestVersion(frontend, [apiVersion, pocketbaseVersion]),
  }
}
