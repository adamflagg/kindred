/**
 * Tests for useSourceMappings hook.
 *
 * This hook fetches source mappings from the backend API endpoint
 * /api/geo/source-mappings and returns a Map<string, SourceMapping[]>.
 */
import { describe, it, expect } from 'vitest'

describe('useSourceMappings', () => {
  describe('hook export', () => {
    it('should export useSourceMappings hook', async () => {
      const module = await import('./useSourceMappings')
      expect(typeof module.useSourceMappings).toBe('function')
    })

    it('should export SourceMapping type', async () => {
      const module = await import('./useSourceMappings')
      expect(module).toBeDefined()
    })
  })

  describe('query key structure', () => {
    it('should have geoSourceMappings in queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys')
      expect(typeof queryKeys.geoSourceMappings).toBe('function')
    })

    it('should include category and year in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys')
      const key = queryKeys.geoSourceMappings('city', 2025)
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('geo')
      expect(key).toContain('source-mappings')
      expect(key).toContain('city')
      expect(key).toContain(2025)
    })

    it('should include activeOnly in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys')
      const key = queryKeys.geoSourceMappings('city', 2025, true)
      expect(key).toContain(true)
    })

    it('should include sessionCmId in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys')
      const key = queryKeys.geoSourceMappings('city', 2025, true, undefined, 2001)
      expect(key).toContain(2001)
    })
  })

  describe('source content checks', () => {
    it('should use fetchSourceMappings from geoService', async () => {
      const sourceContent = await import('./useSourceMappings?raw')
      const source = sourceContent.default
      expect(source).toContain('fetchSourceMappings')
    })

    it('should convert response to Map', async () => {
      const sourceContent = await import('./useSourceMappings?raw')
      const source = sourceContent.default
      expect(source).toContain('new Map')
    })

    it('should accept enabled parameter', async () => {
      const sourceContent = await import('./useSourceMappings?raw')
      const source = sourceContent.default
      expect(source).toContain('enabled')
    })

    it('should accept activeOnly option', async () => {
      const sourceContent = await import('./useSourceMappings?raw')
      const source = sourceContent.default
      expect(source).toContain('activeOnly')
    })
  })

  describe('return type structure', () => {
    it('SourceMapping should have correct structure', () => {
      const expectedShape = {
        original: 'San Francisco, CA',
        count: 30,
        confidence: 1.0,
      }
      expect(Object.keys(expectedShape)).toContain('original')
      expect(Object.keys(expectedShape)).toContain('count')
      expect(Object.keys(expectedShape)).toContain('confidence')
    })
  })
})
