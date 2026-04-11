/**
 * Tests for graph layout utilities
 * Covers layout spacing logic for compound vs non-compound graphs
 */
import { describe, it, expect } from 'vitest'
import { FCOSE_LAYOUT_OPTIONS, getLayoutOptions } from './graphLayout'

describe('FCOSE_LAYOUT_OPTIONS', () => {
  it('has expected default values', () => {
    expect(FCOSE_LAYOUT_OPTIONS.nodeSeparation).toBe(100)
    expect(FCOSE_LAYOUT_OPTIONS.componentSpacing).toBe(120)
  })
})

describe('getLayoutOptions', () => {
  it('returns default spacing when compound nodes exist', () => {
    const options = getLayoutOptions({ hasCompoundNodes: true })
    expect(options.nodeSeparation).toBe(100)
    expect(options.componentSpacing).toBe(120)
  })

  it('returns expanded spacing when no compound nodes exist', () => {
    const options = getLayoutOptions({ hasCompoundNodes: false })
    expect(options.nodeSeparation).toBe(200)
    expect(options.componentSpacing).toBe(250)
  })

  it('preserves other layout properties', () => {
    const options = getLayoutOptions({ hasCompoundNodes: false })
    expect(options.name).toBe('fcose')
    expect(options.numIter).toBe(1000)
    expect(options.fit).toBe(true)
  })
})
