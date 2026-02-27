/**
 * TDD Tests for retention overview tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionOverviewTour from './retentionOverviewTour'

describe('retentionOverviewTour', () => {
  it('has correct tour id', () => {
    expect(retentionOverviewTour.id).toBe('retention-overview')
  })

  it('has version >= 1', () => {
    expect(retentionOverviewTour.version).toBeGreaterThanOrEqual(1)
  })

  it('has 3 tour steps', () => {
    expect(retentionOverviewTour.steps).toHaveLength(3)
  })

  it('uses data-tour selectors in steps', () => {
    for (const step of retentionOverviewTour.steps) {
      if (step.element) {
        expect(step.element).toMatch(/\[data-tour=/)
      }
    }
  })

  it('has isReady function', () => {
    expect(typeof retentionOverviewTour.isReady).toBe('function')
  })
})
