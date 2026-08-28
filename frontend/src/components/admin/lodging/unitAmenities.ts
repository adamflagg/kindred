/**
 * What "Amenities confirmed by staff" asserts, and the glyphs that report it.
 *
 * The flags travel as ONE object because a single checkbox confirms all of
 * them at once — `is_confirmed` asserts that a human has walked the cabin and
 * checked these ten. Keeping the flags and the assertion over them in one
 * value is what stops the form saving one without the other.
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
  Footprints,
  Plug,
  Refrigerator,
  Snowflake,
  Table,
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
// (LodgingUnitRow filters on `unit[flag.key]`), so the four below cost a
// typical row nothing: they are true on 5, 3, 1 and 4 units respectively.
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
]

/**
 * `shareability` is DELIBERATELY NOT in this object (kindred#2026).
 *
 * Everything here is governed by the one `is_confirmed` checkbox, which
 * asserts that a human walked the cabin and checked these ten physical
 * facts. Shareability is not one: it is a POLICY classification, decided at a
 * desk rather than observed in a doorway, so a walk-through cannot confirm it
 * and the checkbox does not apply to it.
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
    has_tub: unit?.has_tub ?? false,
    has_crib: unit?.has_crib ?? false,
    has_changing_table: unit?.has_changing_table ?? false,
    has_shared_fridge: unit?.has_shared_fridge ?? false,
    is_confirmed: unit?.is_confirmed ?? false,
  }
}
