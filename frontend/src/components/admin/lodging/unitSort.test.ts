/**
 * Area is the outer ordering; the chosen column sorts within each area.
 *
 * `sleeps === 0` means UNKNOWN, not zero capacity, so it sorts last in BOTH
 * directions — ascending it must not lead, descending it must not lead either.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingAreaRecord, LodgingUnitRecord } from '../../../types/lodging'
import { groupUnitsByArea, sortUnits, UNIT_SORT_COLUMNS } from './unitSort'

function unit(over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord {
  return {
    area: 'area_1',
    name: 'Cabin',
    code: 'cabin',
    parent_unit: '',
    map_x: 0,
    map_y: 0,
    sleeps: 0,
    beds: null,
    bathroom: '',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    has_tub: false,
    has_kitchenette: false,
    has_crib: false,
    has_changing_table: false,
    has_shared_fridge: false,
    inventory_class: 'family_pool',
    is_confirmed: false,
    is_active: true,
    is_container: false,
    default_combined: false,
    notes: '',
    ...over,
  }
}

const AREAS: LodgingAreaRecord[] = [
  { id: 'area_2', name: 'South Zone', code: 'SOUTH', map_x: 0, map_y: 0, sort_order: 2 },
  { id: 'area_1', name: 'North Zone', code: 'NORTH', map_x: 0, map_y: 0, sort_order: 1 },
]

describe('UNIT_SORT_COLUMNS', () => {
  it('labels every sortable column', () => {
    expect(UNIT_SORT_COLUMNS.length).toBeGreaterThan(0)
    for (const col of UNIT_SORT_COLUMNS) expect(col.label).not.toBe('')
  })
})

describe('sortUnits', () => {
  it('sorts by name ascending', () => {
    const rows = [unit({ id: 'b', name: 'Beta' }), unit({ id: 'a', name: 'Alpha' })]
    expect(sortUnits(rows, { field: 'name', desc: false }).map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('reverses on desc', () => {
    const rows = [unit({ id: 'a', name: 'Alpha' }), unit({ id: 'b', name: 'Beta' })]
    expect(sortUnits(rows, { field: 'name', desc: true }).map((u) => u.id)).toEqual(['b', 'a'])
  })

  it('puts unknown capacity last ascending, not first', () => {
    const rows = [unit({ id: 'unknown', sleeps: 0 }), unit({ id: 'four', sleeps: 4 })]
    expect(sortUnits(rows, { field: 'sleeps', desc: false }).map((u) => u.id)).toEqual([
      'four',
      'unknown',
    ])
  })

  it('puts unknown capacity last descending too', () => {
    const rows = [unit({ id: 'unknown', sleeps: 0 }), unit({ id: 'four', sleeps: 4 })]
    expect(sortUnits(rows, { field: 'sleeps', desc: true }).map((u) => u.id)).toEqual([
      'four',
      'unknown',
    ])
  })

  it('sorts unconfirmed first when sorting by confirmation, because that is the work', () => {
    const rows = [unit({ id: 'yes', is_confirmed: true }), unit({ id: 'no', is_confirmed: false })]
    expect(sortUnits(rows, { field: 'is_confirmed', desc: false }).map((u) => u.id)).toEqual([
      'no',
      'yes',
    ])
  })

  it('does not mutate its input', () => {
    const rows = [unit({ id: 'b', name: 'Beta' }), unit({ id: 'a', name: 'Alpha' })]
    sortUnits(rows, { field: 'name', desc: false })
    expect(rows.map((u) => u.id)).toEqual(['b', 'a'])
  })
})

describe('groupUnitsByArea', () => {
  it('orders groups by the area sort_order, not by name', () => {
    const rows = [unit({ id: 'n', area: 'area_1' }), unit({ id: 's', area: 'area_2' })]
    expect(groupUnitsByArea(rows, AREAS).map((g) => g.areaName)).toEqual([
      'North Zone',
      'South Zone',
    ])
  })

  it('omits an area with no units rather than rendering an empty group', () => {
    const rows = [unit({ id: 'n', area: 'area_1' })]
    expect(groupUnitsByArea(rows, AREAS)).toHaveLength(1)
  })

  it('collects units whose area is unknown into a trailing group rather than dropping them', () => {
    const rows = [unit({ id: 'orphan', area: 'area_gone' })]
    const groups = groupUnitsByArea(rows, AREAS)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.units.map((u) => u.id)).toEqual(['orphan'])
  })
})
