/**
 * Tests for getEdgeLabel utility (moved from EdgeFilters.tsx to constants.ts)
 */

import { describe, it, expect } from 'vitest'
import { getEdgeLabel } from './constants'

// ---------------------------------------------------------------------------
// getEdgeLabel utility
// ---------------------------------------------------------------------------

describe('getEdgeLabel utility', () => {
  it('maps known edge types to display labels', () => {
    expect(getEdgeLabel('request')).toBe('Requests')
    expect(getEdgeLabel('sibling')).toBe('Siblings')
    expect(getEdgeLabel('historical')).toBe('Historical')
  })

  it('falls back to the raw type for unknown edge types', () => {
    expect(getEdgeLabel('unknown')).toBe('unknown')
    expect(getEdgeLabel('custom')).toBe('custom')
  })
})
