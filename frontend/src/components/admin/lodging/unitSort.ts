/**
 * Unit table ordering.
 *
 * Area is the OUTER ordering — staff think about the site by zone, and a flat
 * 93-row list loses that. The chosen column then sorts within each zone.
 *
 * `sleeps === 0` means UNKNOWN (PocketBase stores an unset number as 0), so it
 * sorts last in BOTH directions. Treating it as the smallest number would put
 * every unmeasured cabin at the top of an ascending sort and imply they are
 * the tightest, which is the opposite of true.
 */
import type { LodgingAreaRecord, LodgingUnitRecord } from '../../../types/lodging'

export interface UnitSortColumn {
  field: 'name' | 'code' | 'sleeps' | 'inventory_class' | 'is_confirmed'
  label: string
}

export const UNIT_SORT_COLUMNS: readonly UnitSortColumn[] = [
  { field: 'name', label: 'Unit' },
  { field: 'sleeps', label: 'Sleeps' },
  { field: 'inventory_class', label: 'Allocation' },
  { field: 'is_confirmed', label: 'Status' },
] as const

export type UnitSortField = UnitSortColumn['field']

export interface UnitSort {
  field: UnitSortField
  desc: boolean
}

export interface AreaGroup {
  areaId: string
  areaName: string
  sortOrder: number
  units: LodgingUnitRecord[]
}

/** Sort key. `null` means "always last", regardless of direction. */
function sortKey(unit: LodgingUnitRecord, field: UnitSortField): string | number | null {
  switch (field) {
    case 'name':
      return unit.name.toLowerCase()
    case 'code':
      return unit.code.toLowerCase()
    case 'sleeps':
      // 0 is UNKNOWN, never zero capacity.
      return unit.sleeps > 0 ? unit.sleeps : null
    case 'inventory_class':
      return unit.inventory_class
    case 'is_confirmed':
      // Unconfirmed first ascending: that is the outstanding work, and the
      // roster cannot judge a housing need against an unconfirmed cabin.
      return unit.is_confirmed ? 1 : 0
  }
}

export function sortUnits(units: LodgingUnitRecord[], sort: UnitSort): LodgingUnitRecord[] {
  const direction = sort.desc ? -1 : 1
  return [...units].sort((a, b) => {
    const ka = sortKey(a, sort.field)
    const kb = sortKey(b, sort.field)
    if (ka === null && kb === null) return 0
    if (ka === null) return 1 // unknown last, both directions
    if (kb === null) return -1
    if (ka < kb) return -1 * direction
    if (ka > kb) return 1 * direction
    // Stable tiebreak so equal keys never reshuffle between renders.
    return a.name.localeCompare(b.name)
  })
}

export function groupUnitsByArea(
  units: LodgingUnitRecord[],
  areas: LodgingAreaRecord[]
): AreaGroup[] {
  const byId = new Map(areas.map((a) => [a.id, a]))
  const buckets = new Map<string, AreaGroup>()

  for (const unit of units) {
    const area = byId.get(unit.area)
    const key = area ? area.id : '__unassigned__'
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        areaId: key,
        areaName: area ? area.name : 'No area',
        // An orphaned unit sorts last rather than vanishing — a unit whose
        // area was deleted is a data problem staff need to see.
        sortOrder: area ? area.sort_order : Number.MAX_SAFE_INTEGER,
        units: [],
      }
      buckets.set(key, bucket)
    }
    bucket.units.push(unit)
  }

  return [...buckets.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}
