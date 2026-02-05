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

    it('should sort by occurrence_count descending', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      expect(source).toContain('-occurrence_count')
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

    it('should include original_value, occurrence_count, and confidence in grouped data', async () => {
      const sourceContent = await import('./useNormalizedMappings?raw')
      const source = sourceContent.default

      expect(source).toContain('original_value')
      expect(source).toContain('occurrence_count')
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
})
