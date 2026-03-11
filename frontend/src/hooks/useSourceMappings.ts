/**
 * useSourceMappings - Fetches source mappings from the backend API.
 *
 * Replaces useNormalizedMappings by moving the grouping logic to the backend,
 * which also handles active_only filtering and person deduplication.
 */
import { useQuery } from '@tanstack/react-query'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import * as geoService from '../services/geoService'

import type { SourceMappingItem } from '../services/geoService'

/** A single source string that normalized to a canonical value */
export type SourceMapping = SourceMappingItem

export function useSourceMappings(
  year: number,
  category: string,
  enabled: boolean,
  options?: {
    activeOnly?: boolean
    sessionTypes?: readonly string[]
    sessionCmId?: number
    duration?: string | null | undefined
  }
) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoSourceMappings(
      category,
      year,
      options?.activeOnly,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration ?? undefined
    ),
    queryFn: async () => {
      const fetchOptions: {
        activeOnly?: boolean
        sessionTypes?: string[]
        sessionCmId?: number
        duration?: string
      } = {}
      if (options?.activeOnly !== undefined) fetchOptions.activeOnly = options.activeOnly
      if (options?.sessionTypes) fetchOptions.sessionTypes = [...options.sessionTypes]
      if (options?.sessionCmId !== undefined) fetchOptions.sessionCmId = options.sessionCmId
      if (options?.duration) fetchOptions.duration = options.duration
      const response = await geoService.fetchSourceMappings(
        category,
        year,
        fetchWithAuth,
        fetchOptions
      )
      // Convert Record to Map for backward compat with GeoDetailList/GeoGapsList
      const map = new Map<string, SourceMapping[]>()
      for (const [nv, items] of Object.entries(response.mappings)) {
        map.set(nv, items)
      }
      return map
    },
    enabled,
    ...syncDataOptions,
    staleTime: 5 * 60 * 1000,
  })
}
