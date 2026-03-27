/**
 * TDD Tests for retention bunks tour definition.
 */
import { describe, it, expect } from 'vitest'

import retentionBunksTour from './retentionBunksTour'

describe('retentionBunksTour', () => {
  it('has correct tour id', () => {
    expect(retentionBunksTour.id).toBe('retention-bunks')
  })

  it('has version >= 1', () => {
    expect(retentionBunksTour.version).toBeGreaterThanOrEqual(1)
  })

  it('has 3 tour steps', () => {
    expect(retentionBunksTour.steps).toHaveLength(3)
  })

  it('uses data-tour selectors in steps', () => {
    for (const step of retentionBunksTour.steps) {
      if (step.element) {
        expect(step.element).toMatch(/\[data-tour=/)
      }
    }
  })
})
