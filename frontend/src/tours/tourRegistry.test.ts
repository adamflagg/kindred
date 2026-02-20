import { describe, it, expect } from 'vitest'
import { getTourIdForRoute, loadTourDefinition } from './tourRegistry'

describe('tourRegistry', () => {
  describe('getTourIdForRoute', () => {
    it('returns "debug" for /summer/debug', () => {
      expect(getTourIdForRoute('/summer/debug')).toBe('debug')
    })

    it('returns null for routes without tours', () => {
      expect(getTourIdForRoute('/summer/sessions')).toBeNull()
    })

    it('returns null for empty path', () => {
      expect(getTourIdForRoute('')).toBeNull()
    })

    it('returns null for root path', () => {
      expect(getTourIdForRoute('/')).toBeNull()
    })

    it('handles trailing slashes', () => {
      expect(getTourIdForRoute('/summer/debug/')).toBe('debug')
    })
  })

  describe('loadTourDefinition', () => {
    it('loads the debug tour definition', async () => {
      const definition = await loadTourDefinition('debug')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('debug')
      expect(definition.version).toBeGreaterThanOrEqual(1)
      expect(definition.steps.length).toBeGreaterThan(0)
      expect(typeof definition.isReady).toBe('function')
    })
  })
})
