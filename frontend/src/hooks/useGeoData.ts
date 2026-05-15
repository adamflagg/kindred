/**
 * React Query hooks for geo management API.
 *
 * Wraps geoService functions with caching, invalidation, and auth.
 */

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, userDataOptions, syncDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import * as geoService from '../services/geoService'
import type { OverrideCreateData } from '../services/geoService'
import { mergeCanonical, approveSuggested, rejectSuggested } from '../services/geoService'
import { GEO_CATEGORIES, type GeoCategory } from '../components/admin/geoConstants'

/**
 * Prefetch gaps + canonicals for non-active geo categories so tab switches are instant.
 * Fires on mount and whenever the active category changes.
 *
 * The prefetch is deferred via `requestIdleCallback` so it doesn't compete with the
 * active tab's initial paint and interactivity. Falls back to setTimeout for browsers
 * that don't expose requestIdleCallback (notably Safari pre-16.4).
 */
export function useGeoPagePrefetch(activeCategory: string, year: number, activeOnly: boolean) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()

  useEffect(() => {
    const doPrefetch = () => {
      const otherCategories: GeoCategory[] = GEO_CATEGORIES.filter((c) => c !== activeCategory)
      for (const cat of otherCategories) {
        void queryClient.prefetchQuery({
          queryKey: queryKeys.geoGaps(cat, year, activeOnly),
          queryFn: () => geoService.fetchGeoGaps(cat, year, fetchWithAuth, { activeOnly }),
          ...userDataOptions,
        })
        void queryClient.prefetchQuery({
          queryKey: queryKeys.geoAllCanonicals(cat, year),
          queryFn: () => geoService.fetchAllCanonicals(cat, year, fetchWithAuth),
          ...syncDataOptions,
        })
      }
    }

    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(doPrefetch, { timeout: 2000 })
      return () => window.cancelIdleCallback?.(handle)
    }
    const handle = window.setTimeout(doPrefetch, 1)
    return () => window.clearTimeout(handle)
  }, [activeCategory, year, activeOnly, queryClient, fetchWithAuth])
}

export function useGeoGaps(category: string, year: number, activeOnly = true) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoGaps(category, year, activeOnly),
    queryFn: () => geoService.fetchGeoGaps(category, year, fetchWithAuth, { activeOnly }),
    ...userDataOptions,
  })
}

/**
 * Fetch all in-use canonicals for a category/year. Cached with syncDataOptions (1hr)
 * since this data only changes on sync. Used for instant client-side search.
 */
export function useAllCanonicals(category: string, year: number, inUse = true) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.geoAllCanonicals(category, year, inUse),
    queryFn: () => geoService.fetchAllCanonicals(category, year, fetchWithAuth, inUse),
    ...syncDataOptions,
  })
}

export function useCanonicalSearch(category: string, query: string, year: number, enabled = true) {
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
    mutationFn: (data: OverrideCreateData) => geoService.createOverride(data, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
    },
  })
}

export function useDeleteOverride(category: string, year: number) {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (overrideId: string) => geoService.deleteOverride(overrideId, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
    },
  })
}

export function useBatchResolveCoords(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => geoService.batchResolveCoords(category, year, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
    },
  })
}

export function useMergeCanonical(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { canonicalName: string; target: string }) =>
      mergeCanonical(data.canonicalName, { target: data.target, category, year }, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
    },
  })
}

export function useApproveSuggested(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      canonicalName: string
      city?: string
      state?: string
      country?: string
    }) => approveSuggested(data.canonicalName, { category, year, ...data }, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
    },
  })
}

export function useRejectSuggested(category: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { canonicalName: string }) =>
      rejectSuggested(data.canonicalName, { category, year }, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGapsPrefix(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
    },
  })
}
