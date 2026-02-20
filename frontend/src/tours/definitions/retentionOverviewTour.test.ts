/**
 * TDD Tests for retention overview tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionOverviewTour from './retentionOverviewTour'
import type { HintDefinition } from '../types'

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
    expect(retentionOverviewTour.hints!.length).toBe(1)
  })

  it('has session-selector hint only (not duplicating tour steps)', () => {
    const hintElements = retentionOverviewTour.hints!.map((h: HintDefinition) => h.element)
    expect(hintElements).toContain('[data-tour="retention-session-selector"]')
    // Should NOT have hints on elements that are already tour steps
    expect(hintElements).not.toContain('[data-tour="retention-summary-cards"]')
    expect(hintElements).not.toContain('[data-tour="retention-demographics"]')
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
