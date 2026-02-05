/**
 * useNormalizedMappings - Fetches normalized_mappings grouped by normalized_value.
 *
 * Used by GeoAnalysis to show the original source strings that were
 * normalized to each canonical value.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

/** A single source string that normalized to a canonical value */
export interface SourceMapping {
  original: string
  count: number
  confidence: number
}

/** Valid categories in normalized_mappings table */
export type NormalizedCategory = 'city' | 'school' | 'congregation'

/**
 * Fetches normalized_mappings and groups them by normalized_value.
 *
 * @param year - The year to filter by
 * @param category - The category to filter by (city, school, congregation)
 * @param enabled - Whether the query should be enabled
 * @returns Map of normalized_value -> array of source mappings
 */
export function useNormalizedMappings(
  year: number,
  category: NormalizedCategory,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.normalizedMappings(year, category),
    queryFn: async () => {
      const records = await pb.collection('normalized_mappings').getFullList({
        filter: `year = ${year} && category = "${category}"`,
        sort: '-occurrence_count',
      })

      // Group by normalized_value
      const grouped = new Map<string, SourceMapping[]>()

      for (const record of records) {
        const key = record['normalized_value'] as string
        const existing = grouped.get(key) ?? []
        existing.push({
          original: record['original_value'] as string,
          count: (record['occurrence_count'] as number) ?? 0,
          confidence: (record['confidence'] as number) ?? 1.0,
        })
        grouped.set(key, existing)
      }

      return grouped
    },
    enabled,
    ...syncDataOptions,
    staleTime: 5 * 60 * 1000, // 5 min cache - this data changes only after sync
  })
}
