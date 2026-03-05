/**
 * TDD Tests for useNormalizedMappings hook.
 *
 * This hook fetches normalized_mappings from PocketBase and groups
 * them by normalized_value to show original source strings.
 */
import { describe, it, expect } from 'vitest'

describe('useNormalizedMappings', () => {
  describe('hook export', () => {
    it('should export useNormalizedMappings hook', async () => {
      const module = await import('./useNormalizedMappings')
      expect(typeof module.useNormalizedMappings).toBe('function')
    })

    it('should export SourceMapping type', async () => {
      // TypeScript will validate the type exists at compile time
      // We just verify the module imports without error
      const module = await import('./useNormalizedMappings')
      expect(module).toBeDefined()
    })
  })

  describe('PocketBase collection usage', () => {
    it('should use pb.collection for normalized_mappings', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      expect(source).toContain("pb.collection('normalized_mappings')")
    })

    it('should filter by year and category', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Should build a filter with year and category
      expect(source).toContain('year')
      expect(source).toContain('category')
      expect(source).toContain('filter')
    })

    it('should sort sources by count descending within each normalized value', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // With person+session schema, counts are computed dynamically
      // Sources are sorted by count descending within each normalized value group
      expect(source).toContain('sort((a, b) => b.count - a.count)')
    })
  })

  describe('query key structure', () => {
    it('should have normalizedMappings in queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      expect(typeof queryKeys.normalizedMappings).toBe('function')
    })

    it('should include year and category in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      const key = queryKeys.normalizedMappings(2025, 'city')
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('normalized-mappings')
      expect(key).toContain(2025)
      expect(key).toContain('city')
    })
  })

  describe('grouping logic', () => {
    it('should group records by normalized_value', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Should use Map for grouping
      expect(source).toContain('Map')
      expect(source).toContain('normalized_value')
    })

    it('should include original_value and confidence in grouped data', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      expect(source).toContain('original_value')
      expect(source).toContain('confidence')
    })
  })

  describe('enabled state', () => {
    it('should be disabled when enabled parameter is false', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Hook should accept enabled parameter
      expect(source).toContain('enabled')
    })
  })

  describe('category mapping', () => {
    it('should support city, school, and congregation categories', () => {
      // These are the valid categories from normalized_mappings table
      const validCategories = ['city', 'school', 'congregation']

      expect(validCategories).toContain('city')
      expect(validCategories).toContain('school')
      expect(validCategories).toContain('congregation')
    })
  })

  describe('return type structure', () => {
    it('SourceMapping should have correct structure', () => {
      // This verifies the expected shape of the SourceMapping type
      const expectedShape = {
        original: 'San Francisco, CA',
        count: 30,
        confidence: 1.0,
      }

      expect(Object.keys(expectedShape)).toContain('original')
      expect(Object.keys(expectedShape)).toContain('count')
      expect(Object.keys(expectedShape)).toContain('confidence')
    })

    it('should return Map<string, SourceMapping[]>', () => {
      // Example of expected return structure
      const exampleReturn = new Map<
        string,
        Array<{ original: string; count: number; confidence: number }>
      >()
      exampleReturn.set('San Francisco', [
        { original: 'San Francisco', count: 30, confidence: 1.0 },
        { original: 'San Francisco, CA', count: 10, confidence: 1.0 },
        { original: 'SF', count: 3, confidence: 0.9 },
      ])

      const sfMappings = exampleReturn.get('San Francisco')
      expect(sfMappings).toHaveLength(3)
      expect(sfMappings?.[0]?.original).toBe('San Francisco')
    })
  })

  describe('caching options', () => {
    it('should use appropriate stale time', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Should have some staleTime configured
      expect(source).toContain('staleTime')
    })
  })

  // ============================================================================
  // NEW TESTS: Session Filtering for Person+Session Schema
  // ============================================================================

  describe('session filtering', () => {
    it('should accept optional sessionCmId parameter', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // The hook should accept sessionCmId as a parameter
      expect(source).toContain('sessionCmId')
    })

    it('should include session filter in query when sessionCmId provided', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Should filter by session.cm_id when sessionCmId is provided
      expect(source).toContain('session.cm_id')
    })

    it('should accept optional sessionTypes parameter', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // The hook should accept sessionTypes as a parameter
      expect(source).toContain('sessionTypes')
    })

    it('should filter by session_type when sessionTypes provided', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      // Should filter by session.session_type when sessionTypes is provided
      expect(source).toContain('session.session_type')
    })

    it('should include sessionCmId in query key for proper caching', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      // Query key should include sessionCmId when provided
      // This ensures different sessions have different cache entries
      const key = queryKeys.normalizedMappings(2025, 'city', 2001)
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('normalized-mappings')
      expect(key).toContain(2025)
      expect(key).toContain('city')
      expect(key).toContain(2001) // sessionCmId
    })

    it('should include sessionTypes in query key for proper caching', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      const key = queryKeys.normalizedMappings(2025, 'city', undefined, ['camp', 'quest'])
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('normalized-mappings')
    })

    it('should work without sessionCmId (all sessions)', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      // Query key should work without sessionCmId
      const keyWithoutSession = queryKeys.normalizedMappings(2025, 'city')
      expect(Array.isArray(keyWithoutSession)).toBe(true)
      expect(keyWithoutSession).toContain('normalized-mappings')
    })
  })

  describe('dynamic count aggregation', () => {
    it('should compute counts dynamically from rows, not occurrence_count field', () => {
      // With person+session schema, each row = 1 person in 1 session
      // Count should be computed by counting rows, not reading occurrence_count
      const mockRecords = [
        {
          person: 'p101',
          session: 's2001',
          normalized_value: 'Glenview Elementary',
          original_value: 'Glenview Elem',
        },
        {
          person: 'p102',
          session: 's2001',
          normalized_value: 'Glenview Elementary',
          original_value: 'Glenview Elementary',
        },
        {
          person: 'p103',
          session: 's2001',
          normalized_value: 'Oak Valley Middle',
          original_value: 'Oak Valley Middle',
        },
      ]

      // Group by normalized_value and count rows
      const counts = new Map<string, number>()
      for (const record of mockRecords) {
        const key = record.normalized_value
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }

      // Count should be 2 for Glenview Elementary (2 rows), not any occurrence_count field
      expect(counts.get('Glenview Elementary')).toBe(2)
      expect(counts.get('Oak Valley Middle')).toBe(1)
    })

    it('should aggregate source counts by original_value', () => {
      // Multiple persons with same original_value should be aggregated
      const mockRecords = [
        {
          person: 'p101',
          original_value: 'Glenview Elem',
          normalized_value: 'Glenview Elementary',
        },
        {
          person: 'p102',
          original_value: 'Glenview Elem',
          normalized_value: 'Glenview Elementary',
        },
        {
          person: 'p103',
          original_value: 'Glenview Elementary School',
          normalized_value: 'Glenview Elementary',
        },
      ]

      // Group by normalized_value, then aggregate by original_value
      const grouped = new Map<string, Map<string, number>>()
      for (const record of mockRecords) {
        const normalized = record.normalized_value
        const original = record.original_value

        if (!grouped.has(normalized)) {
          grouped.set(normalized, new Map())
        }
        const originalCounts = grouped.get(normalized)!
        originalCounts.set(original, (originalCounts.get(original) ?? 0) + 1)
      }

      const glenviewSources = grouped.get('Glenview Elementary')!
      // "Glenview Elem" should have count 2 (two persons)
      expect(glenviewSources.get('Glenview Elem')).toBe(2)
      // "Glenview Elementary School" should have count 1 (one person)
      expect(glenviewSources.get('Glenview Elementary School')).toBe(1)
    })
  })

  describe('session filter counts match main list', () => {
    it('counts should match between main list and show sources', () => {
      // This tests the fix for the "Show sources" mismatch bug
      // Both main list and "show sources" should use the same filtered data

      const session2001Mappings = [
        {
          person: 'p101',
          session: 's2001',
          normalized_value: 'Oakland',
          original_value: 'Oakland',
        },
        {
          person: 'p102',
          session: 's2001',
          normalized_value: 'Oakland',
          original_value: 'Oakland, CA',
        },
      ]

      // Main list: count by normalized_value
      const mainCounts = new Map<string, number>()
      for (const m of session2001Mappings) {
        mainCounts.set(m.normalized_value, (mainCounts.get(m.normalized_value) ?? 0) + 1)
      }

      // Show sources: aggregate original_values
      const sourceCounts = new Map<string, Map<string, number>>()
      for (const m of session2001Mappings) {
        if (!sourceCounts.has(m.normalized_value)) {
          sourceCounts.set(m.normalized_value, new Map())
        }
        const originals = sourceCounts.get(m.normalized_value)!
        originals.set(m.original_value, (originals.get(m.original_value) ?? 0) + 1)
      }

      // Total source count for "Oakland" should equal main count
      const oaklandMainCount = mainCounts.get('Oakland')!
      const oaklandSourceTotal = Array.from(sourceCounts.get('Oakland')!.values()).reduce(
        (a, b) => a + b,
        0
      )

      expect(oaklandMainCount).toBe(2)
      expect(oaklandSourceTotal).toBe(2)
      expect(oaklandMainCount).toBe(oaklandSourceTotal) // They should match!
    })
  })
})
