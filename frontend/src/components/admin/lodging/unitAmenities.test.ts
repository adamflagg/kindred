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

describe('shareability', () => {
  // kindred#2026. Edited beside the other unit-level classifications rather
  // than derived in the form: the rule that produced the stored value lives in
  // the migration and the Go loader, and a third copy in the browser would be
  // the one staff could not see disagreeing.

  it('reads a new unit as unclassified rather than as one family', () => {
    // '' is UNKNOWN, and the staffer has to answer it. Defaulting a fresh
    // unit to 'single_party' would look tidier and would be a claim nobody
    // made — the same failure the select exists to prevent on the read side.
    expect(amenitiesOf().shareability).toBe('')
  })

  it('carries a stored classification off an existing unit', () => {
    const unit = { shareability: 'shareable' } as Parameters<typeof amenitiesOf>[0]
    expect(amenitiesOf(unit).shareability).toBe('shareable')
  })
})
