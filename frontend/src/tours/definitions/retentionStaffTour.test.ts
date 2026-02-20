/**
 * TDD Tests for retention staff tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionStaffTour from './retentionStaffTour'

describe('retentionStaffTour', () => {
  it('has correct tour id', () => {
    expect(retentionStaffTour.id).toBe('retention-staff')
  })

  it('has version >= 1', () => {
    expect(retentionStaffTour.version).toBeGreaterThanOrEqual(1)
  })

  it('has 3 tour steps', () => {
    expect(retentionStaffTour.steps).toHaveLength(3)
  })

  it('has hints defined', () => {
    expect(retentionStaffTour.hints).toBeDefined()
    expect(retentionStaffTour.hints!.length).toBe(3)
  })

  it('uses data-tour selectors in steps', () => {
    for (const step of retentionStaffTour.steps) {
      if (step.element) {
        expect(step.element).toMatch(/\[data-tour=/)
      }
    }
  })

  it('uses data-tour selectors in hints', () => {
    for (const hint of retentionStaffTour.hints!) {
      expect(hint.element).toMatch(/\[data-tour=/)
    }
  })

  it('has isReady function', () => {
    expect(typeof retentionStaffTour.isReady).toBe('function')
  })
})
