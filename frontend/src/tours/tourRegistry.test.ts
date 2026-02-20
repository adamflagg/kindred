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

    // Retention sub-page route mappings
    it('returns "retention-overview" for /metrics/retention', () => {
      expect(getTourIdForRoute('/metrics/retention')).toBe('retention-overview')
    })

    it('returns "retention-flow" for /metrics/retention/flow', () => {
      expect(getTourIdForRoute('/metrics/retention/flow')).toBe('retention-flow')
    })

    it('returns "retention-bunks" for /metrics/retention/bunks', () => {
      expect(getTourIdForRoute('/metrics/retention/bunks')).toBe('retention-bunks')
    })

    it('returns "retention-staff" for /metrics/retention/staff', () => {
      expect(getTourIdForRoute('/metrics/retention/staff')).toBe('retention-staff')
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

    it('loads the retention-overview tour definition', async () => {
      const definition = await loadTourDefinition('retention-overview')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('retention-overview')
      expect(definition.steps.length).toBeGreaterThan(0)
    })

    it('loads the retention-flow tour definition', async () => {
      const definition = await loadTourDefinition('retention-flow')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('retention-flow')
      expect(definition.steps.length).toBeGreaterThan(0)
    })

    it('loads the retention-bunks tour definition', async () => {
      const definition = await loadTourDefinition('retention-bunks')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('retention-bunks')
      expect(definition.steps.length).toBeGreaterThan(0)
    })

    it('loads the retention-staff tour definition', async () => {
      const definition = await loadTourDefinition('retention-staff')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('retention-staff')
      expect(definition.steps.length).toBeGreaterThan(0)
    })
  })
})
