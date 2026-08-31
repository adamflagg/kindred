import { describe, expect, it } from 'vitest'

import {
  AMENITY_CAP,
  AMENITY_PRIORITY,
  capAmenityMarks,
  type AmenityMark,
  type AmenityMarkKey,
} from './amenityCap'

function mark(key: AmenityMarkKey): AmenityMark<AmenityMarkKey> {
  return { key, node: key }
}

describe('amenityCap — the ruled constants', () => {
  it('caps at 3, never more', () => {
    expect(AMENITY_CAP).toBe(3)
  })

  it('carries the owner-ruled order, bathroom first and AC last', () => {
    // docs/plans/2026-08-31-mockup-icon-crowding.html's correction-box —
    // verbatim, and every key from LodgingUnitCard's row must appear exactly
    // once so a future mark added to the card cannot silently fall out of
    // this table.
    expect(AMENITY_PRIORITY).toEqual([
      'bathroom',
      'power',
      'fridge',
      'heat',
      'step-free',
      'not-weatherized',
      'ac',
    ])
  })
})

describe('amenityCap — capAmenityMarks', () => {
  it('is a no-op at or below the cap — 3 marks pass through untouched, in order', () => {
    const marks = [mark('power'), mark('bathroom'), mark('ac')]
    const result = capAmenityMarks(marks)
    expect(result.visible).toEqual(marks)
    expect(result.overflow).toEqual([])
  })

  it('is a no-op for zero marks', () => {
    expect(capAmenityMarks([])).toEqual({ visible: [], overflow: [] })
  })

  it('keeps the top 3 by priority, dropping the rest, when there are exactly 4', () => {
    // ac is last in AMENITY_PRIORITY, so it is the one dropped.
    const marks = [mark('bathroom'), mark('power'), mark('ac'), mark('fridge')]
    const result = capAmenityMarks(marks)
    expect(result.visible.map((m) => m.key)).toEqual(['bathroom', 'power', 'fridge'])
    expect(result.overflow.map((m) => m.key)).toEqual(['ac'])
  })

  it('returns the survivors in RENDER order, never priority order', () => {
    // All 7 marks, given in the card's own render order (bathroom, power,
    // ac, fridge, heat, not-weatherized, step-free). Top 3 by priority are
    // bathroom, power, fridge — but fridge sits AFTER ac in render order, so
    // a priority-ordered return would be wrong here in a way a same-order
    // fixture could not catch.
    const marks: AmenityMark<AmenityMarkKey>[] = [
      mark('bathroom'),
      mark('power'),
      mark('ac'),
      mark('fridge'),
      mark('heat'),
      mark('not-weatherized'),
      mark('step-free'),
    ]
    const result = capAmenityMarks(marks)
    expect(result.visible.map((m) => m.key)).toEqual(['bathroom', 'power', 'fridge'])
    expect(result.overflow.map((m) => m.key)).toEqual([
      'ac',
      'heat',
      'not-weatherized',
      'step-free',
    ])
  })

  it("drops AC first on a 5-mark unit with no fridge (Willow Downstairs A/B's real shape)", () => {
    // bathroom, power, ac, heat, step-free — the exact profile the failure
    // this feature fixes is about. Priority order filtered to these five is
    // bathroom(0), power(1), heat(3), step-free(4), ac(6) — top 3 is
    // bathroom/power/heat.
    const marks: AmenityMark<AmenityMarkKey>[] = [
      mark('bathroom'),
      mark('power'),
      mark('ac'),
      mark('heat'),
      mark('step-free'),
    ]
    const result = capAmenityMarks(marks)
    expect(result.visible.map((m) => m.key)).toEqual(['bathroom', 'power', 'heat'])
    expect(result.overflow.map((m) => m.key)).toEqual(['ac', 'step-free'])
  })

  it('never mutates its input array', () => {
    const marks: AmenityMark<AmenityMarkKey>[] = [
      mark('bathroom'),
      mark('power'),
      mark('ac'),
      mark('fridge'),
    ]
    const copy = [...marks]
    capAmenityMarks(marks)
    expect(marks).toEqual(copy)
  })
})
