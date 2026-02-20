/**
 * TDD Tests for retention flow tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionFlowTour from './retentionFlowTour'

describe('retentionFlowTour', () => {
  it('has correct tour id', () => {
    expect(retentionFlowTour.id).toBe('retention-flow')
  })

  it('has version >= 1', () => {
    expect(retentionFlowTour.version).toBeGreaterThanOrEqual(1)
  })

  it('has 2 tour steps', () => {
    expect(retentionFlowTour.steps).toHaveLength(2)
  })

  it('has hints defined', () => {
    expect(retentionFlowTour.hints).toBeDefined()
    expect(retentionFlowTour.hints!.length).toBe(1)
  })

  it('has session-selector hint (not duplicating tour steps)', () => {
    expect(retentionFlowTour.hints![0].element).toBe('[data-tour="retention-session-selector"]')
  })

  it('uses data-tour selectors in steps', () => {
    for (const step of retentionFlowTour.steps) {
      if (step.element) {
        expect(step.element).toMatch(/\[data-tour=/)
      }
    }
  })

  it('uses data-tour selectors in hints', () => {
    for (const hint of retentionFlowTour.hints!) {
      expect(hint.element).toMatch(/\[data-tour=/)
    }
  })

  it('has isReady function', () => {
    expect(typeof retentionFlowTour.isReady).toBe('function')
  })
})
