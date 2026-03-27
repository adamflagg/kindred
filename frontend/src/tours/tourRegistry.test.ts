import { describe, it, expect } from 'vitest'
import { getTourIdForRoute, loadTourDefinition, loadLayerDefinition } from './tourRegistry'

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

    // Retention routes
    it('returns "retention-overview" for /analytics/retention', () => {
      expect(getTourIdForRoute('/analytics/retention')).toBe('retention-overview')
    })

    it('returns "retention-flow" for /analytics/retention/flow', () => {
      expect(getTourIdForRoute('/analytics/retention/flow')).toBe('retention-flow')
    })

    it('returns "retention-bunks" for /analytics/retention/bunks', () => {
      expect(getTourIdForRoute('/analytics/retention/bunks')).toBe('retention-bunks')
    })

    it('returns "retention-staff" for /analytics/retention/staff', () => {
      expect(getTourIdForRoute('/analytics/retention/staff')).toBe('retention-staff')
    })

    // Registration routes
    it('returns "registration-overview" for /analytics/registration/overview', () => {
      expect(getTourIdForRoute('/analytics/registration/overview')).toBe('registration-overview')
    })

    it('returns "registration-geo" for /analytics/registration/geo', () => {
      expect(getTourIdForRoute('/analytics/registration/geo')).toBe('registration-geo')
    })

    it('returns "registration-waitlist" for /analytics/registration/waitlist', () => {
      expect(getTourIdForRoute('/analytics/registration/waitlist')).toBe('registration-waitlist')
    })

    it('returns "registration-availability" for /analytics/registration/availability', () => {
      expect(getTourIdForRoute('/analytics/registration/availability')).toBe(
        'registration-availability'
      )
    })

    it('returns "registration-forecast" for /analytics/registration/forecast', () => {
      expect(getTourIdForRoute('/analytics/registration/forecast')).toBe('registration-forecast')
    })

    it('returns "registration-cancellations" for /analytics/registration/cancellations', () => {
      expect(getTourIdForRoute('/analytics/registration/cancellations')).toBe(
        'registration-cancellations'
      )
    })

    it('returns "registration-day1" for /analytics/registration/day1', () => {
      expect(getTourIdForRoute('/analytics/registration/day1')).toBe('registration-day1')
    })

    // Trends routes
    it('returns "trends-overview" for /analytics/trends', () => {
      expect(getTourIdForRoute('/analytics/trends')).toBe('trends-overview')
    })

    it('returns "trends-velocity" for /analytics/trends/velocity', () => {
      expect(getTourIdForRoute('/analytics/trends/velocity')).toBe('trends-velocity')
    })

    it('returns "trends-cancellations" for /analytics/trends/cancellations', () => {
      expect(getTourIdForRoute('/analytics/trends/cancellations')).toBe('trends-cancellations')
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
      expect(Array.isArray(definition.layers)).toBe(true)
    })

    it('loads the retention-overview tour definition', async () => {
      const definition = await loadTourDefinition('retention-overview')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('retention-overview')
      expect(definition.steps.length).toBeGreaterThan(0)
      expect(definition.layers).toContain('metrics-header')
    })

    it('loads the registration-overview tour definition', async () => {
      const definition = await loadTourDefinition('registration-overview')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('registration-overview')
      expect(definition.layers).toEqual(['metrics-header', 'registration-intro'])
    })

    it('loads the trends-velocity tour definition', async () => {
      const definition = await loadTourDefinition('trends-velocity')
      expect(definition).toBeDefined()
      expect(definition.id).toBe('trends-velocity')
      expect(definition.layers).toEqual(['metrics-header', 'trends-intro'])
    })
  })

  describe('loadLayerDefinition', () => {
    it('loads the metrics-header layer', async () => {
      const layer = await loadLayerDefinition('metrics-header')
      expect(layer).toBeDefined()
      expect(layer.id).toBe('metrics-header')
      expect(layer.version).toBeGreaterThanOrEqual(1)
      expect(layer.steps.length).toBeGreaterThan(0)
    })

    it('loads the registration-intro layer', async () => {
      const layer = await loadLayerDefinition('registration-intro')
      expect(layer).toBeDefined()
      expect(layer.id).toBe('registration-intro')
    })

    it('loads the trends-intro layer', async () => {
      const layer = await loadLayerDefinition('trends-intro')
      expect(layer).toBeDefined()
      expect(layer.id).toBe('trends-intro')
    })
  })
})
