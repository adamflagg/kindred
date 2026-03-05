/**
 * React Query hooks for geo management API.
 *
 * Wraps geoService functions with caching, invalidation, and auth.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import * as geoService from '../services/geoService'
import type { OverrideCreateData } from '../services/geoService'

export function useGeoGaps(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoGaps(category, year),
    queryFn: () => geoService.fetchGeoGaps(category, year, fetchWithAuth),
    ...userDataOptions,
  })
}

export function useCanonicalSearch(
  category: string,
  query: string,
  year: number,
  enabled = true
) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoCanonicals(category, query, year),
    queryFn: () => geoService.searchCanonicals(category, query, year, fetchWithAuth),
    enabled,
    ...userDataOptions,
  })
}

export function useCanonicalSources(
  category: string,
  canonicalName: string,
  year: number,
  enabled = false
) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoSources(category, canonicalName, year),
    queryFn: () => geoService.fetchSources(category, canonicalName, year, fetchWithAuth),
    enabled,
    ...userDataOptions,
  })
}

export function useGeoOverrides(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoOverrides(category, year),
    queryFn: () => geoService.fetchOverrides(category, year, fetchWithAuth),
    ...userDataOptions,
  })
}

export function useCreateOverride(category: string, year: number) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (data: OverrideCreateData) =>
      geoService.createOverride(data, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGaps(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
    },
  })
}

export function useUpdateOverride(category: string, year: number) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: ({ overrideId, data }: { overrideId: string; data: Partial<OverrideCreateData> }) =>
      geoService.updateOverride(overrideId, data, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGaps(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
    },
  })
}

export function useDeleteOverride(category: string, year: number) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (overrideId: string) =>
      geoService.deleteOverride(overrideId, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGaps(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
    },
  })
}
