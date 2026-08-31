/**
 * What "Amenities confirmed by staff" asserts, and the glyphs that report it.
 *
 * The flags travel as ONE object because a single checkbox confirms all of
 * them at once — `is_confirmed` asserts that a human has walked the cabin and
 * checked every flag `AMENITY_FLAGS` lists. Keeping the flags and the
 * assertion over them in one value is what stops the form saving one without
 * the other. (Deliberately not restated as a count here — the count itself
 * has already gone stale once; see `AMENITY_FLAGS`'s own header.)
 *
 * ⚠️ THE ASSERTION NO LONGER GATES ANYTHING DOWNSTREAM (kindred#2526). It
 * used to: an unconfirmed row's `has_power: false` read as "nobody has said"
 * and the roster refused to grade it. Values are taken at face value now, and
 * `is_confirmed` drives the `Reconfirm space` work-down list alone.
 *
 * ONE registry, two surfaces. The form renders `AMENITY_FLAGS` as checkboxes
 * and the units table renders the same entries as row glyphs, so an amenity
 * cannot appear in the editor and go missing from the list staff confirm from.
 */
import {
  Accessibility,
  Baby,
  Bath,
  ChefHat,
  Droplet,
  Flame,
  Footprints,
  Home,
  Lightbulb,
  Plug,
  Refrigerator,
  Snowflake,
  Sofa,
  SquareDashed,
  Table,
  Thermometer,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { BathroomStoredValue, LodgingUnitRecord } from '../../../types/lodging'

export type AmenityFlag =
  | 'has_power'
  | 'has_ac'
  | 'has_fridge'
  | 'near_bathhouse'
  | 'is_accessible'
  | 'is_weatherized'
  | 'has_plumbing'
  | 'has_space_heater'
  | 'has_lights'
  | 'has_heat'
  | 'has_pack_play_space'
  | 'has_kitchen'
  | 'has_living_room'
  | 'has_tub'
  | 'has_crib'
  | 'has_changing_table'
  | 'has_shared_fridge'

export interface UnitAmenities {
  bathroom: BathroomStoredValue
  bathroom_group: string
  has_power: boolean
  has_ac: boolean
  has_fridge: boolean
  near_bathhouse: boolean
  is_accessible: boolean
  // The ORIGINAL 2026 inventory migration's fields (1500000131) — the first
  // amenity columns the registry ever carried, six migrations before the
  // Master Housing sheet fields below. Populated by the registry import from
  // day one, but with no editing surface anywhere in the app until this pass.
  is_weatherized: boolean
  has_plumbing: boolean
  has_space_heater: boolean
  has_lights: boolean
  has_heat: boolean
  has_pack_play_space: boolean
  has_kitchen: boolean
  has_living_room: boolean
  // Added with the 2026 Master Housing import. Each REFINES a field above
  // rather than restating it — has_tub under `bathroom`, has_shared_fridge
  // under has_fridge — so none can contradict its parent and a surface reading
  // only the parent stays correct. has_kitchenette (narrowing has_kitchen) was
  // dropped in kindred#2390: 0 production rows disagreed with their parent.
  has_tub: boolean
  has_crib: boolean
  has_changing_table: boolean
  has_shared_fridge: boolean
  is_confirmed: boolean
}

// The row glyphs render only the flags that are TRUE
// (LodgingUnitRow filters on `unit[flag.key]`). The four Master Housing flags
// below cost a typical row nothing — they are true on a handful of units each
// — but the eight original-inventory flags added below THAT are a different
// story: `is_weatherized` alone is true on 96 of 118 production units, so a
// confirmed cabin's row will usually carry several of these glyphs now. That
// is the accurate picture, not a layout bug — see the module header.
//
// Every entry here MUST have a slot in `UnitAmenities` and be read by
// `amenitiesOf` below, or it renders as a checkbox the form silently drops on
// save. `unitAmenities.test.ts` pins both halves of that contract.
export const AMENITY_FLAGS: readonly { key: AmenityFlag; label: string; icon: LucideIcon }[] = [
  { key: 'has_power', label: 'Has power', icon: Plug },
  { key: 'has_ac', label: 'Has A/C', icon: Snowflake },
  { key: 'has_fridge', label: 'Has fridge', icon: Refrigerator },
  { key: 'has_shared_fridge', label: 'Fridge is shared', icon: Users },
  { key: 'near_bathhouse', label: 'Near bathhouse', icon: Footprints },
  { key: 'is_accessible', label: 'Accessible', icon: Accessibility },
  { key: 'has_tub', label: 'Has tub', icon: Bath },
  // Distinct from has_pack_play_space: a camp-provided crib is not floor space
  // for a family's own pack-and-play, and families with babies ask about both.
  { key: 'has_crib', label: 'Has crib', icon: Baby },
  { key: 'has_changing_table', label: 'Has changing table', icon: Table },
  // The original 2026 inventory migration's eight (1500000131) — populated by
  // the registry import since day one, but with no editing surface until now.
  { key: 'is_weatherized', label: 'Weatherized', icon: Home },
  { key: 'has_plumbing', label: 'Has plumbing', icon: Droplet },
  // Distinct from has_heat: a space heater is portable and needs an outlet,
  // so it is not the same claim as a heated cabin (see the migration).
  { key: 'has_space_heater', label: 'Has space heater', icon: Flame },
  { key: 'has_lights', label: 'Has lights', icon: Lightbulb },
  { key: 'has_heat', label: 'Has heat', icon: Thermometer },
  // The unit-side counterpart to a family's own infant flag — floor space for
  // a family's pack-and-play, distinct from has_crib (a camp-provided crib).
  { key: 'has_pack_play_space', label: 'Pack-n-play space', icon: SquareDashed },
  { key: 'has_kitchen', label: 'Has kitchen', icon: ChefHat },
  { key: 'has_living_room', label: 'Has living room', icon: Sofa },
]

/**
 * `shareability` is DELIBERATELY NOT in this object (kindred#2026).
 *
 * Everything here is governed by the one `is_confirmed` checkbox, which
 * asserts that a human walked the cabin and checked every `AMENITY_FLAGS`
 * physical fact. Shareability is not one: it is a POLICY classification,
 * decided at a desk rather than observed in a doorway, so a walk-through
 * cannot confirm it and the checkbox does not apply to it.
 *
 * ⚠️ THE ORIGINAL ARGUMENT HERE WAS A DIFFERENT ONE and no longer holds:
 * "the board trusts shareability immediately and discounts these until
 * confirmed". kindred#2526 took the discount away — every value is read at
 * face value — so the separation now rests on the observed/decided
 * distinction above, which is what it was really about. The ruling is
 * unchanged; only its reason had to move.
 *
 * It lives in its own `useState` in `LodgingUnitForm`, alongside the other
 * policy classifications (`inventoryClass`, `isContainer`, `combined`), and is
 * passed to `UnitAmenityFieldset` as its own prop purely so the control renders
 * in that section of the form.
 */

/** An existing unit's amenity state, or the all-unrecorded state for a new one. */
export function amenitiesOf(unit?: LodgingUnitRecord): UnitAmenities {
  return {
    // The stored vocabulary, not the read API's — the API renders an empty
    // column as the token `unknown`, which PocketBase would reject on write.
    bathroom: unit?.bathroom ?? '',
    bathroom_group: unit?.bathroom_group ?? '',
    has_power: unit?.has_power ?? false,
    has_ac: unit?.has_ac ?? false,
    has_fridge: unit?.has_fridge ?? false,
    near_bathhouse: unit?.near_bathhouse ?? false,
    is_accessible: unit?.is_accessible ?? false,
    is_weatherized: unit?.is_weatherized ?? false,
    has_plumbing: unit?.has_plumbing ?? false,
    has_space_heater: unit?.has_space_heater ?? false,
    has_lights: unit?.has_lights ?? false,
    has_heat: unit?.has_heat ?? false,
    has_pack_play_space: unit?.has_pack_play_space ?? false,
    has_kitchen: unit?.has_kitchen ?? false,
    has_living_room: unit?.has_living_room ?? false,
    has_tub: unit?.has_tub ?? false,
    has_crib: unit?.has_crib ?? false,
    has_changing_table: unit?.has_changing_table ?? false,
    has_shared_fridge: unit?.has_shared_fridge ?? false,
    is_confirmed: unit?.is_confirmed ?? false,
  }
}
