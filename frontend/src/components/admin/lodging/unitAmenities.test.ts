/**
 * AMENITY_FLAGS is ONE registry feeding two surfaces — the form's checkboxes
 * and the units table's row glyphs. These assert the two cannot drift, which is
 * the property the module exists to hold: an amenity that appears in the editor
 * and goes missing from the list staff confirm from gets confirmed blind.
 */
import { describe, expect, it } from 'vitest'

import { AMENITY_FLAGS, amenitiesOf, type UnitAmenities } from './unitAmenities'

// has_kitchenette was one of the original five (narrowing has_kitchen) but was
// dropped in kindred#2390: 0 production rows disagreed with their parent, so
// staff ruled the split not worth tracking. See the dedicated test below.
const NEW_2026_FLAGS = ['has_tub', 'has_crib', 'has_changing_table', 'has_shared_fridge'] as const

// The eight booleans the ORIGINAL 2026 inventory migration (1500000131) put
// on lodging_units — before near_bathhouse/has_power/has_ac/has_fridge/
// is_accessible even existed on every unit, and six migrations before the
// Master Housing sheet fields above. They were populated by the registry
// import from day one but had no editing surface anywhere in the app until
// this pass closed that gap.
const ORIGINAL_INVENTORY_FLAGS = [
  'is_weatherized',
  'has_plumbing',
  'has_space_heater',
  'has_lights',
  'has_heat',
  'has_pack_play_space',
  'has_kitchen',
  'has_living_room',
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

  it('carries the surviving four of the five facts the 2026 Master Housing sheet added', () => {
    const keys = new Set<string>(AMENITY_FLAGS.map((f) => f.key))
    for (const key of NEW_2026_FLAGS) {
      expect(keys.has(key), `${key} is not in AMENITY_FLAGS`).toBe(true)
    }
  })

  it('carries the eight original-inventory flags that had no editing surface until now', () => {
    const keys = new Set<string>(AMENITY_FLAGS.map((f) => f.key))
    for (const key of ORIGINAL_INVENTORY_FLAGS) {
      expect(keys.has(key), `${key} is not in AMENITY_FLAGS`).toBe(true)
    }
  })

  it('accounts for every boolean amenity lodging_units carries — 17, not 9', () => {
    // Pinned against production (year 2026, 118 units): the 9 already wired
    // plus these 8 are the full set of editable amenity booleans the schema
    // has. is_confirmed, shareability and has_ramp are deliberately NOT
    // amenities (see the module docstring and the test below) and capacity/
    // bathroom fields are their own thing entirely.
    expect(AMENITY_FLAGS.length).toBe(17)
  })

  it('gives every flag a slot in the amenity object the form saves', () => {
    // A flag rendered as a checkbox but absent from UnitAmenities would be
    // editable and then silently dropped on save.
    const amenities = amenitiesOf() as unknown as Record<string, unknown>
    for (const flag of AMENITY_FLAGS) {
      expect(flag.key in amenities, `${flag.key} is missing from amenitiesOf()`).toBe(true)
    }
  })

  it('drops has_kitchenette — collapsed into has_kitchen, kindred#2390', () => {
    // Every production unit with has_kitchenette=true already had
    // has_kitchen=true (0 counterexamples), so the split carried no
    // information staff act on. The column is gone; nothing here should
    // still offer it.
    expect(AMENITY_FLAGS.some((f) => (f.key as string) === 'has_kitchenette')).toBe(false)
    const amenities = amenitiesOf() as unknown as Record<string, unknown>
    expect('has_kitchenette' in amenities).toBe(false)
  })
})

describe('amenitiesOf', () => {
  it('reads a new unit as all-unrecorded rather than all-absent', () => {
    const fresh = amenitiesOf()
    for (const key of NEW_2026_FLAGS) {
      expect(fresh[key as keyof UnitAmenities]).toBe(false)
    }
    for (const key of ORIGINAL_INVENTORY_FLAGS) {
      expect(fresh[key as keyof UnitAmenities], key).toBe(false)
    }
    expect(fresh.is_confirmed).toBe(false)
  })

  it('carries the new flags off an existing unit', () => {
    const unit = {
      has_tub: true,
      has_crib: true,
      has_changing_table: true,
      has_shared_fridge: true,
    } as Parameters<typeof amenitiesOf>[0]

    const amenities = amenitiesOf(unit)
    for (const key of NEW_2026_FLAGS) {
      expect(amenities[key as keyof UnitAmenities], key).toBe(true)
    }
  })

  it('carries the original-inventory flags off an existing unit', () => {
    const unit = {
      is_weatherized: true,
      has_plumbing: true,
      has_space_heater: true,
      has_lights: true,
      has_heat: true,
      has_pack_play_space: true,
      has_kitchen: true,
      has_living_room: true,
    } as Parameters<typeof amenitiesOf>[0]

    const amenities = amenitiesOf(unit)
    for (const key of ORIGINAL_INVENTORY_FLAGS) {
      expect(amenities[key as keyof UnitAmenities], key).toBe(true)
    }
  })
})

describe('shareability is deliberately NOT an amenity (kindred#2026)', () => {
  it('stays out of the bag the is_confirmed checkbox governs', () => {
    // The regression this pins: everything in UnitAmenities is a physical fact
    // one checkbox asserts a human walked the cabin and checked. Shareability
    // is a POLICY classification decided at a desk, so a walk-through cannot
    // confirm it and folding it back in here would have it saved and asserted
    // by a click that does not apply to it. (The original wording rested on
    // the board "discounting" unconfirmed values, which kindred#2526 ended;
    // see unitAmenities.ts.) It lives in its own state in LodgingUnitForm; the
    // payload assertions are there.
    expect('shareability' in amenitiesOf()).toBe(false)
  })

  it('is not an AMENITY_FLAGS entry either', () => {
    expect(AMENITY_FLAGS.some((f) => (f.key as string) === 'shareability')).toBe(false)
  })
})
