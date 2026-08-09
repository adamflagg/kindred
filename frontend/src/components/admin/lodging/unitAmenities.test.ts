/**
 * AMENITY_FLAGS is ONE registry feeding two surfaces — the form's checkboxes
 * and the units table's row glyphs. These assert the two cannot drift, which is
 * the property the module exists to hold: an amenity that appears in the editor
 * and goes missing from the list staff confirm from gets confirmed blind.
 */
import { describe, expect, it } from 'vitest'

import { AMENITY_FLAGS, amenitiesOf, type UnitAmenities } from './unitAmenities'

const NEW_2026_FLAGS = [
  'has_tub',
  'has_kitchenette',
  'has_crib',
  'has_changing_table',
  'has_shared_fridge',
] as const

describe('AMENITY_FLAGS', () => {
  it('has a unique key, a label and an icon for every entry', () => {
    const keys = AMENITY_FLAGS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const flag of AMENITY_FLAGS) {
      expect(flag.label).not.toBe('')
      expect(flag.icon).toBeTruthy()
    }
  })

  it('carries the five facts the 2026 Master Housing sheet added', () => {
    const keys = new Set<string>(AMENITY_FLAGS.map((f) => f.key))
    for (const key of NEW_2026_FLAGS) {
      expect(keys.has(key), `${key} is not in AMENITY_FLAGS`).toBe(true)
    }
  })

  it('gives every flag a slot in the amenity object the form saves', () => {
    // A flag rendered as a checkbox but absent from UnitAmenities would be
    // editable and then silently dropped on save.
    const amenities = amenitiesOf() as unknown as Record<string, unknown>
    for (const flag of AMENITY_FLAGS) {
      expect(flag.key in amenities, `${flag.key} is missing from amenitiesOf()`).toBe(true)
    }
  })
})

describe('amenitiesOf', () => {
  it('reads a new unit as all-unrecorded rather than all-absent', () => {
    const fresh = amenitiesOf()
    for (const key of NEW_2026_FLAGS) {
      expect(fresh[key as keyof UnitAmenities]).toBe(false)
    }
    expect(fresh.is_confirmed).toBe(false)
  })

  it('carries the new flags off an existing unit', () => {
    const unit = {
      has_tub: true,
      has_kitchenette: true,
      has_crib: true,
      has_changing_table: true,
      has_shared_fridge: true,
    } as Parameters<typeof amenitiesOf>[0]

    const amenities = amenitiesOf(unit)
    for (const key of NEW_2026_FLAGS) {
      expect(amenities[key as keyof UnitAmenities], key).toBe(true)
    }
  })
})

describe('shareability is deliberately NOT an amenity (kindred#2026)', () => {
  it('stays out of the bag the is_confirmed checkbox governs', () => {
    // The regression this pins: everything in UnitAmenities is confirmed by one
    // checkbox, and until it is ticked the roster reads `has_power: false` as
    // "nobody has said". Shareability is trusted by the read path the moment it
    // is stored, so folding it back in here would put a value the board acts on
    // beside values the board discounts, saved by the same click. It lives in
    // its own state in LodgingUnitForm; the payload assertions are there.
    expect('shareability' in amenitiesOf()).toBe(false)
  })

  it('is not an AMENITY_FLAGS entry either', () => {
    expect(AMENITY_FLAGS.some((f) => (f.key as string) === 'shareability')).toBe(false)
  })
})
