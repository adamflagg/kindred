/**
 * What "Amenities confirmed by staff" asserts, and the glyphs that report it.
 *
 * The flags travel as ONE object because a single checkbox confirms all of
 * them at once: until `is_confirmed` is true the roster reads `has_power:
 * false` as "nobody has said", not "there is no power". Keeping the flags and
 * the assertion over them in one value is what stops the form saving one
 * without the other.
 *
 * ONE registry, two surfaces. The form renders `AMENITY_FLAGS` as checkboxes
 * and the units table renders the same entries as row glyphs, so an amenity
 * cannot appear in the editor and go missing from the list staff confirm from.
 */
import { Accessibility, Footprints, Plug, Refrigerator, Snowflake } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { BathroomStoredValue, LodgingUnitRecord } from '../../../types/lodging'

export type AmenityFlag = 'has_power' | 'has_ac' | 'has_fridge' | 'near_bathhouse' | 'is_accessible'

export interface UnitAmenities {
  bathroom: BathroomStoredValue
  bathroom_group: string
  has_power: boolean
  has_ac: boolean
  has_fridge: boolean
  near_bathhouse: boolean
  is_accessible: boolean
  is_confirmed: boolean
}

export const AMENITY_FLAGS: readonly { key: AmenityFlag; label: string; icon: LucideIcon }[] = [
  { key: 'has_power', label: 'Has power', icon: Plug },
  { key: 'has_ac', label: 'Has A/C', icon: Snowflake },
  { key: 'has_fridge', label: 'Has fridge', icon: Refrigerator },
  { key: 'near_bathhouse', label: 'Near bathhouse', icon: Footprints },
  { key: 'is_accessible', label: 'Accessible', icon: Accessibility },
]

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
    is_confirmed: unit?.is_confirmed ?? false,
  }
}
