/**
 * TDD Tests for retention staff tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionStaffTour from './retentionStaffTour'
import type { HintDefinition } from '../types'

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
    expect(retentionStaffTour.hints!.length).toBe(2)
  })

  it('has only non-tour-step hints', () => {
    const hintElements = retentionStaffTour.hints!.map((h: HintDefinition) => h.element)
    // These are NOT covered by tour steps
    expect(hintElements).toContain('[data-tour="retention-staff-sort-overall"]')
    expect(hintElements).toContain('[data-tour="retention-staff-table"]')
    // This IS a tour step — should not be a hint
    expect(hintElements).not.toContain('[data-tour="retention-staff-sort-name"]')
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
