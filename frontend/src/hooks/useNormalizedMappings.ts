/**
 * useNormalizedMappings - Fetches normalized_mappings grouped by normalized_value.
 *
 * Used by GeoAnalysis to show the original source strings that were
 * normalized to each canonical value.
 *
 * With the person+session schema, each row represents one (person, session, category)
 * mapping. Counts are computed dynamically by counting rows, not from occurrence_count.
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
 * With the person+session schema, each row = 1 person in 1 session.
 * Counts are computed by aggregating rows, not reading occurrence_count.
 *
 * @param year - The year to filter by
 * @param category - The category to filter by (city, school, congregation)
 * @param enabled - Whether the query should be enabled
 * @param sessionCmId - Optional session CampMinder ID to filter by
 * @returns Map of normalized_value -> array of source mappings
 */
export function useNormalizedMappings(
  year: number,
  category: NormalizedCategory,
  enabled: boolean,
  sessionCmId?: number
) {
  return useQuery({
    queryKey: queryKeys.normalizedMappings(year, category, sessionCmId),
    queryFn: async () => {
      // Build filter with optional session filter
      let filter = `year = ${year} && category = "${category}"`
      if (sessionCmId !== undefined) {
        filter += ` && session.cm_id = ${sessionCmId}`
      }

      const records = await pb.collection('normalized_mappings').getFullList({
        filter,
        sort: '-created',
      })

      // Step 1: Group by normalized_value, then by original_value
      // Each row = 1 person, so we count rows to get person counts
      const byNormalized = new Map<string, Map<string, { count: number; confidence: number }>>()

      for (const record of records) {
        const normalizedValue = record['normalized_value']
        const originalValue = record['original_value']
        const confidence = record['confidence'] ?? 1.0

        let originals = byNormalized.get(normalizedValue)
        if (!originals) {
          originals = new Map()
          byNormalized.set(normalizedValue, originals)
        }
        const existing = originals.get(originalValue)

        if (existing) {
          // Increment count for this original value
          existing.count++
          // Keep the minimum confidence (most conservative)
          existing.confidence = Math.min(existing.confidence, confidence)
        } else {
          originals.set(originalValue, { count: 1, confidence })
        }
      }

      // Step 2: Convert to final Map<string, SourceMapping[]> format
      const grouped = new Map<string, SourceMapping[]>()

      for (const [normalizedValue, originals] of byNormalized) {
        const sources: SourceMapping[] = []
        for (const [original, data] of originals) {
          sources.push({
            original,
            count: data.count,
            confidence: data.confidence,
          })
        }
        // Sort by count descending within each normalized value
        sources.sort((a, b) => b.count - a.count)
        grouped.set(normalizedValue, sources)
      }

      return grouped
    },
    enabled,
    ...syncDataOptions,
    staleTime: 5 * 60 * 1000, // 5 min cache - this data changes only after sync
  })
}
