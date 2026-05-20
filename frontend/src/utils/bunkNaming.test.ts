/**
 * Tests for the shared bunk-naming helpers.
 *
 * These helpers were extracted from BunkSocialGraphModal so utility
 * modules (`utils/bunkSwap`) and the swap modal could consume them
 * without depending on a UI component.
 */
import { describe, expect, it } from 'vitest'
import { extractSortKey, getBunkType, isAGBunkName } from './bunkNaming'

describe('isAGBunkName', () => {
  it.each([
    ['AG', true],
    ['AG-1', true],
    ['AG1', true],
    ['AG Alph', true],
    ['BAG-1', false],
    ['B-1AG', false],
    ['Stage-1', false],
    ['', false],
  ])('isAGBunkName(%s) === %s', (name, expected) => {
    expect(isAGBunkName(name)).toBe(expected)
  })
})

describe('getBunkType', () => {
  it('returns B for an empty string', () => {
    expect(getBunkType('')).toBe('B')
  })

  it('classifies boy bunks', () => {
    expect(getBunkType('B-1')).toBe('B')
    expect(getBunkType('B-12')).toBe('B')
  })

  it('classifies girl bunks', () => {
    expect(getBunkType('G-1')).toBe('G')
    expect(getBunkType('G-7')).toBe('G')
  })

  it('classifies AG bunks by prefix', () => {
    expect(getBunkType('AG-1')).toBe('AG')
    expect(getBunkType('AG1')).toBe('AG')
  })

  it('falls back to B for unrecognised names', () => {
    expect(getBunkType('Cabin-5')).toBe('B')
  })

  // #1164: classification was previously a substring match (`name.includes('AG')`),
  // which mis-classified incidental occurrences. The match must be prefix-anchored.
  it.each([
    ['STAGE', 'B'],
    ['page', 'B'],
    ['BAG-1', 'B'],
    ['B-1AG', 'B'],
    ['Stage-1', 'B'],
  ])('does NOT classify %s as AG (incidental match)', (name, expected) => {
    expect(getBunkType(name)).toBe(expected)
  })
})

describe('extractSortKey', () => {
  it('places Alpha bunks at primary -2', () => {
    expect(extractSortKey('Alpha').primary).toBe(-2)
    expect(extractSortKey('B-Alph-1').primary).toBe(-2)
  })

  it('places Beta bunks at primary -1', () => {
    expect(extractSortKey('Beta').primary).toBe(-1)
    expect(extractSortKey('G-Bet-2').primary).toBe(-1)
  })

  it('extracts numeric sort key for numbered bunks', () => {
    expect(extractSortKey('B-3').primary).toBe(3)
    expect(extractSortKey('G-10').primary).toBe(10)
  })

  it('sorts lower numbers before higher numbers', () => {
    const k1 = extractSortKey('B-1')
    const k2 = extractSortKey('B-9')
    expect(k1.primary).toBeLessThan(k2.primary)
  })

  it('falls back to primary 999 for unrecognised patterns', () => {
    expect(extractSortKey('Unknown').primary).toBe(999)
  })
})
