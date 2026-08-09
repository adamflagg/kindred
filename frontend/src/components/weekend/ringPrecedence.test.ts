import { describe, expect, it } from 'vitest'

import { resolveRingPrecedence } from './ringPrecedence'

describe('resolveRingPrecedence', () => {
  it('is plain when nothing is set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: false, shared: false })).toBe(
      'plain'
    )
  })

  it('is shared when only shared is set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: false, shared: true })).toBe(
      'shared'
    )
  })

  it('is consentFlagged when only consentFlagged is set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: true, shared: false })).toBe(
      'consentFlagged'
    )
  })

  it('is dropTarget when only dropTarget is set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: false, shared: false })).toBe(
      'dropTarget'
    )
  })

  it('prefers consentFlagged over shared when both are set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: true, shared: true })).toBe(
      'consentFlagged'
    )
  })

  it('prefers dropTarget over consentFlagged when both are set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: true, shared: false })).toBe(
      'dropTarget'
    )
  })

  it('prefers dropTarget over shared when both are set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: false, shared: true })).toBe(
      'dropTarget'
    )
  })

  it('prefers dropTarget over everything when all three are set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: true, shared: true })).toBe(
      'dropTarget'
    )
  })

  /**
   * kindred#2183 — the map is a reference surface with no placement, so it
   * OMITS `dropTarget` rather than passing a hard-coded `false` the reader has
   * to interpret. An absent drop target must resolve exactly as `false` did.
   */
  describe('a caller with no placement affordance at all', () => {
    it('is plain when nothing else is set either', () => {
      expect(resolveRingPrecedence({ consentFlagged: false, shared: false })).toBe('plain')
    })

    it('is shared when the room is shared', () => {
      expect(resolveRingPrecedence({ consentFlagged: false, shared: true })).toBe('shared')
    })

    it('is consentFlagged when the sharing was never consented to', () => {
      expect(resolveRingPrecedence({ consentFlagged: true, shared: true })).toBe('consentFlagged')
    })
  })
})
