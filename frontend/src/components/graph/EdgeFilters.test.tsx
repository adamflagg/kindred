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
  })

  it('falls back to the raw type for unknown edge types', () => {
    expect(getEdgeLabel('unknown')).toBe('unknown')
    expect(getEdgeLabel('custom')).toBe('custom')
    // Sibling is intentionally not labeled — the type is removed.
    expect(getEdgeLabel('sibling')).toBe('sibling')
  })
})
