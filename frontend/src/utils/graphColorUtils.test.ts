/**
 * Tests for deterministic graph color utilities
 * TDD - tests written first, implementation follows
 *
 * Covers feedback items:
 * #31 - One color per unit applied to all bunks in that unit
 * #33 - Deterministic/static colors based on present bunks/units
 */

import { describe, it, expect } from 'vitest'
import { getUnitColorForBunk, getUnitColorByName, UNIT_PALETTE } from './graphColorUtils'

describe('getUnitColorForBunk', () => {
  it('returns the same color for the same bunk name', () => {
    const color1 = getUnitColorForBunk('B-5', ['B-5', 'G-5', 'B-7', 'G-7'])
    const color2 = getUnitColorForBunk('B-5', ['B-5', 'G-5', 'B-7', 'G-7'])
    expect(color1).toBe(color2)
  })

  it('returns the same color for different bunks in the same unit', () => {
    // B-5 and G-5 are both in Eilat — they must share a color
    const bunkList = ['B-5', 'G-5', 'B-7', 'G-7']
    const colorB5 = getUnitColorForBunk('B-5', bunkList)
    const colorG5 = getUnitColorForBunk('G-5', bunkList)
    expect(colorB5).toBe(colorG5)
  })

  it('returns different colors for different units when palette is large enough', () => {
    const bunkList = ['B-1', 'G-1', 'B-3', 'G-3', 'B-5', 'G-5']
    // B-1/G-1 = Carmel, B-3/G-3 = Galil, B-5/G-5 = Eilat
    const carmelColor = getUnitColorForBunk('B-1', bunkList)
    const galilColor = getUnitColorForBunk('B-3', bunkList)
    const eilatColor = getUnitColorForBunk('B-5', bunkList)
    expect(carmelColor).not.toBe(galilColor)
    expect(galilColor).not.toBe(eilatColor)
    expect(carmelColor).not.toBe(eilatColor)
  })

  it('is deterministic: same set of bunks always produces same mapping', () => {
    const bunkList = ['B-7', 'G-7', 'B-9', 'G-9', 'B-11', 'G-11']
    const run1 = bunkList.map((b) => getUnitColorForBunk(b, bunkList))
    const run2 = bunkList.map((b) => getUnitColorForBunk(b, bunkList))
    expect(run1).toEqual(run2)
  })

  it('returns a fallback color for unknown bunk names', () => {
    const color = getUnitColorForBunk('Unknown-99', ['Unknown-99'])
    expect(typeof color).toBe('string')
    expect(color.length).toBeGreaterThan(0)
  })

  it('cycles palette deterministically when more units than palette entries', () => {
    // Build a list with all 7 known units present
    const allBunks = ['B-Aleph', 'B-1', 'B-3', 'B-5', 'B-7', 'B-9', 'B-11']
    // All should return a non-empty string color without throwing
    for (const bunk of allBunks) {
      const color = getUnitColorForBunk(bunk, allBunks)
      expect(typeof color).toBe('string')
      expect(color.length).toBeGreaterThan(0)
    }
  })
})

describe('getUnitColorByName', () => {
  it('returns a color for a known unit name', () => {
    const color = getUnitColorByName('Eilat', ['Carmel', 'Eilat', 'Haifa'])
    expect(typeof color).toBe('string')
    expect(color.length).toBeGreaterThan(0)
  })

  it('returns the same color for the same unit name given the same unit list', () => {
    const unitList = ['Carmel', 'Eilat', 'Haifa']
    const c1 = getUnitColorByName('Eilat', unitList)
    const c2 = getUnitColorByName('Eilat', unitList)
    expect(c1).toBe(c2)
  })

  it('returns different colors for distinct units', () => {
    const unitList = ['Carmel', 'Eilat', 'Haifa']
    const carmel = getUnitColorByName('Carmel', unitList)
    const eilat = getUnitColorByName('Eilat', unitList)
    const haifa = getUnitColorByName('Haifa', unitList)
    expect(carmel).not.toBe(eilat)
    expect(eilat).not.toBe(haifa)
    expect(carmel).not.toBe(haifa)
  })
})

describe('globally stable colors across sessions (#33)', () => {
  /**
   * Spec lock 2026-04-24: a unit's color must depend only on its canonical
   * name, not on the other units present in the current graph. Repro: TOC2
   * (Chalutzim 1, Chalutzim 2) and Session 3 (Carmel, Galil, Eilat, Haifa)
   * both rendered a greyish-blue but for different units, because the per-
   * session sorted-index assignment landed Galil at index 0 in Session 3 and
   * Chalutzim 1 at index 0 in TOC2.
   */
  it('Eilat gets the same color regardless of which other units are present', () => {
    const sessionA = getUnitColorByName('Eilat', ['Carmel', 'Eilat', 'Haifa'])
    const sessionB = getUnitColorByName('Eilat', ['Eilat', 'Chalutzim 1'])
    const sessionC = getUnitColorByName('Eilat', ['Eilat'])
    expect(sessionA).toBe(sessionB)
    expect(sessionB).toBe(sessionC)
  })

  it('Galil and Chalutzim 1 do not collide on greyish-blue across sessions', () => {
    const galilSession3 = getUnitColorByName('Galil', ['Carmel', 'Galil', 'Eilat', 'Haifa'])
    const chalutzim1TOC2 = getUnitColorByName('Chalutzim 1', ['Chalutzim 1', 'Chalutzim 2'])
    expect(galilSession3).not.toBe(chalutzim1TOC2)
  })

  it('B-5 (Eilat) gets the same color in any bunk set that contains Eilat', () => {
    const setA = getUnitColorForBunk('B-5', ['B-5', 'G-5', 'B-7', 'G-7'])
    const setB = getUnitColorForBunk('B-5', ['B-1', 'B-3', 'B-5'])
    const setC = getUnitColorForBunk('B-5', ['B-5'])
    expect(setA).toBe(setB)
    expect(setB).toBe(setC)
  })
})

describe('UNIT_PALETTE', () => {
  it('is a non-empty array of color strings', () => {
    expect(Array.isArray(UNIT_PALETTE)).toBe(true)
    expect(UNIT_PALETTE.length).toBeGreaterThan(0)
  })

  it('contains valid hex or hsl color strings', () => {
    for (const color of UNIT_PALETTE) {
      const isHex = /^#[0-9a-fA-F]{3,8}$/.test(color)
      const isHsl = color.startsWith('hsl')
      expect(isHex || isHsl).toBe(true)
    }
  })

  it('has at least 7 entries to cover all units without cycling', () => {
    expect(UNIT_PALETTE.length).toBeGreaterThanOrEqual(7)
  })
})
