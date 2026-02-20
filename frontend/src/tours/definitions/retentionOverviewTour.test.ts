/**
 * TDD Tests for retention overview tour definition.
 */
import { describe, it, expect } from 'vitest'

// Will be created as default export
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

  it('has hints defined', () => {
    expect(retentionOverviewTour.hints).toBeDefined()
    expect(retentionOverviewTour.hints!.length).toBe(3)
  })

  it('uses data-tour selectors in steps', () => {
    for (const step of retentionOverviewTour.steps) {
      if (step.element) {
        expect(step.element).toMatch(/\[data-tour=/)
      }
    }
  })

  it('uses data-tour selectors in hints', () => {
    for (const hint of retentionOverviewTour.hints!) {
      expect(hint.element).toMatch(/\[data-tour=/)
    }
  })

  it('has isReady function', () => {
    expect(typeof retentionOverviewTour.isReady).toBe('function')
  })
})
