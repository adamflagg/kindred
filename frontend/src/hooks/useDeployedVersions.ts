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

// A version holds only until the next deploy, and a tab can outlive one. So it
// goes stale after 5 minutes and is re-read when the window regains focus;
// the feedback modal also forces a fresh api read when it opens.
const FRESHNESS = {
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: true,
} as const

/**
 * The version each Kindred component was built at. CD rebuilds only the images
 * whose files changed and retags the rest, so after an api-only release the
 * frontend's baked version is older than the api's. Each server reports its
 * own; `newest` is what the Help menu shows. Feedback sends the frontend's and
 * the api's; PocketBase states its own, server-side.
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
    ...FRESHNESS,
  })

  const pocketbase = useQuery({
    queryKey: queryKeys.deployedVersion('pocketbase'),
    queryFn: async (): Promise<string | null> =>
      versionField(await pb.send('/api/custom/version', { method: 'GET' }), 'pocketbase'),
    enabled,
    ...FRESHNESS,
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
