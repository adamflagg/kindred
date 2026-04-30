/**
 * Tests for unit mapping utility
 * Maps bunk names (e.g. "B-1", "G-12", "Aleph") to unit names
 */
import { describe, it, expect } from 'vitest'
import { getUnitForBunk, getUnitSideForBunk, UNIT_COLORS, getBunksInUnit } from './unitMapping'

describe('getUnitForBunk', () => {
  describe('Nitzanim unit (Aleph, Bet)', () => {
    it('maps Aleph to Nitzanim', () => {
      expect(getUnitForBunk('Aleph')).toBe('Nitzanim')
    })

    it('maps Bet to Nitzanim', () => {
      expect(getUnitForBunk('Bet')).toBe('Nitzanim')
    })

    it('is case-insensitive', () => {
      expect(getUnitForBunk('aleph')).toBe('Nitzanim')
      expect(getUnitForBunk('ALEPH')).toBe('Nitzanim')
      expect(getUnitForBunk('BET')).toBe('Nitzanim')
    })
  })

  describe('Carmel unit (cabins 1, 2)', () => {
    it('maps B-1 to Carmel', () => {
      expect(getUnitForBunk('B-1')).toBe('Carmel')
    })

    it('maps G-2 to Carmel', () => {
      expect(getUnitForBunk('G-2')).toBe('Carmel')
    })

    it('maps AG-1 to Carmel', () => {
      expect(getUnitForBunk('AG-1')).toBe('Carmel')
    })
  })

  describe('Galil unit (cabins 3, 4)', () => {
    it('maps B-3 to Galil', () => {
      expect(getUnitForBunk('B-3')).toBe('Galil')
    })

    it('maps G-4 to Galil', () => {
      expect(getUnitForBunk('G-4')).toBe('Galil')
    })
  })

  describe('Eilat unit (cabins 5, 6)', () => {
    it('maps B-5 to Eilat', () => {
      expect(getUnitForBunk('B-5')).toBe('Eilat')
    })

    it('maps G-6 to Eilat', () => {
      expect(getUnitForBunk('G-6')).toBe('Eilat')
    })
  })

  describe('Haifa unit (cabins 7, 8)', () => {
    it('maps B-7 to Haifa', () => {
      expect(getUnitForBunk('B-7')).toBe('Haifa')
    })

    it('maps G-8 to Haifa', () => {
      expect(getUnitForBunk('G-8')).toBe('Haifa')
    })
  })

  describe('Chalutzim 1 unit (cabins 9, 10)', () => {
    it('maps B-9 to Chalutzim 1', () => {
      expect(getUnitForBunk('B-9')).toBe('Chalutzim 1')
    })

    it('maps G-10 to Chalutzim 1', () => {
      expect(getUnitForBunk('G-10')).toBe('Chalutzim 1')
    })
  })

  describe('Chalutzim 2 unit (cabins 11, 12)', () => {
    it('maps B-11 to Chalutzim 2', () => {
      expect(getUnitForBunk('B-11')).toBe('Chalutzim 2')
    })

    it('maps G-12 to Chalutzim 2', () => {
      expect(getUnitForBunk('G-12')).toBe('Chalutzim 2')
    })

    it('maps AG-12 to Chalutzim 2', () => {
      expect(getUnitForBunk('AG-12')).toBe('Chalutzim 2')
    })
  })

  describe('unknown bunk names', () => {
    it('returns null for unrecognized names', () => {
      expect(getUnitForBunk('Unknown Cabin')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(getUnitForBunk('')).toBeNull()
    })

    it('returns null for fallback "Bunk 12345" names', () => {
      expect(getUnitForBunk('Bunk 12345')).toBeNull()
    })
  })

  describe('gender prefix variants', () => {
    it('handles B- (boys) prefix', () => {
      expect(getUnitForBunk('B-5')).toBe('Eilat')
    })

    it('handles G- (girls) prefix', () => {
      expect(getUnitForBunk('G-5')).toBe('Eilat')
    })

    it('handles AG- (adventure group) prefix', () => {
      expect(getUnitForBunk('AG-5')).toBe('Eilat')
    })
  })

  describe('sub-bunk variants (trailing letter)', () => {
    it('maps B-5A to Eilat', () => {
      expect(getUnitForBunk('B-5A')).toBe('Eilat')
    })

    it('maps G-3B to Galil', () => {
      expect(getUnitForBunk('G-3B')).toBe('Galil')
    })

    it('maps AG-11a to Chalutzim 2 (case-insensitive suffix)', () => {
      expect(getUnitForBunk('AG-11a')).toBe('Chalutzim 2')
    })

    it('maps B-1A to Carmel', () => {
      expect(getUnitForBunk('B-1A')).toBe('Carmel')
    })
  })

  describe('prefixed Nitzanim names', () => {
    it('maps B-Aleph to Nitzanim', () => {
      expect(getUnitForBunk('B-Aleph')).toBe('Nitzanim')
    })

    it('maps B-Bet to Nitzanim', () => {
      expect(getUnitForBunk('B-Bet')).toBe('Nitzanim')
    })

    it('maps G-Aleph to Nitzanim', () => {
      expect(getUnitForBunk('G-Aleph')).toBe('Nitzanim')
    })

    it('maps G-Bet to Nitzanim', () => {
      expect(getUnitForBunk('G-Bet')).toBe('Nitzanim')
    })

    it('is case-insensitive for prefixed names', () => {
      expect(getUnitForBunk('b-aleph')).toBe('Nitzanim')
      expect(getUnitForBunk('g-bet')).toBe('Nitzanim')
    })
  })
})

describe('getUnitSideForBunk', () => {
  it('returns boys side for B- prefix', () => {
    expect(getUnitSideForBunk('B-5')).toEqual({ unit: 'Eilat', side: 'B' })
  })

  it('returns girls side for G- prefix', () => {
    expect(getUnitSideForBunk('G-5')).toEqual({ unit: 'Eilat', side: 'G' })
  })

  it('returns null side for AG- prefix (free-floating)', () => {
    expect(getUnitSideForBunk('AG-5')).toEqual({ unit: 'Eilat', side: null })
  })

  it('returns boys side for B-Aleph', () => {
    expect(getUnitSideForBunk('B-Aleph')).toEqual({ unit: 'Nitzanim', side: 'B' })
  })

  it('returns girls side for G-Bet', () => {
    expect(getUnitSideForBunk('G-Bet')).toEqual({ unit: 'Nitzanim', side: 'G' })
  })

  it('returns null side for unprefixed Aleph (ambiguous → float)', () => {
    expect(getUnitSideForBunk('Aleph')).toEqual({ unit: 'Nitzanim', side: null })
  })

  it('returns null side for unprefixed Bet (ambiguous → float)', () => {
    expect(getUnitSideForBunk('Bet')).toEqual({ unit: 'Nitzanim', side: null })
  })

  it('handles trailing letter sub-bunk variants', () => {
    expect(getUnitSideForBunk('B-3A')).toEqual({ unit: 'Galil', side: 'B' })
    expect(getUnitSideForBunk('G-12b')).toEqual({ unit: 'Chalutzim 2', side: 'G' })
  })

  it('is case-insensitive on prefix', () => {
    expect(getUnitSideForBunk('b-5')).toEqual({ unit: 'Eilat', side: 'B' })
    expect(getUnitSideForBunk('g-Bet')).toEqual({ unit: 'Nitzanim', side: 'G' })
  })

  it('returns null for unrecognized names', () => {
    expect(getUnitSideForBunk('Unknown')).toBeNull()
    expect(getUnitSideForBunk('')).toBeNull()
    expect(getUnitSideForBunk('Bunk 12345')).toBeNull()
  })
})

describe('UNIT_COLORS', () => {
  it('has a color for every unit', () => {
    const expectedUnits = [
      'Nitzanim',
      'Carmel',
      'Galil',
      'Eilat',
      'Haifa',
      'Chalutzim 1',
      'Chalutzim 2',
    ]
    for (const unit of expectedUnits) {
      expect(UNIT_COLORS[unit]).toBeDefined()
      expect(typeof UNIT_COLORS[unit]).toBe('string')
    }
  })

  it('colors are unique', () => {
    const colors = Object.values(UNIT_COLORS)
    const unique = new Set(colors)
    expect(unique.size).toBe(colors.length)
  })
})

describe('getBunksInUnit', () => {
  it('returns the bunks that belong to the named unit', () => {
    const all = ['B-3', 'G-3', 'B-4', 'G-4', 'B-5', 'G-5']
    expect(getBunksInUnit('Galil', all)).toEqual(['B-3', 'G-3', 'B-4', 'G-4'])
  })

  it('returns AG bunks under their numeric unit', () => {
    expect(getBunksInUnit('Galil', ['AG-3', 'AG-5'])).toEqual(['AG-3'])
  })

  it('returns Nitzanim bunks for prefixed and unprefixed Aleph/Bet', () => {
    const all = ['Aleph', 'Bet', 'B-Aleph', 'G-Bet']
    expect(getBunksInUnit('Nitzanim', all)).toEqual(['Aleph', 'Bet', 'B-Aleph', 'G-Bet'])
  })

  it('returns empty array for unknown unit', () => {
    expect(getBunksInUnit('Nope', ['B-3', 'G-5'])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(getBunksInUnit('Galil', [])).toEqual([])
  })
})
