/**
 * Reserved units stay VISIBLE and badged (spec §3.7) — staff reason about
 * adjacency and hiding them would make the map lie about the site.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import { UnitInventoryPanel } from './UnitInventoryPanel'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-a',
    name: 'Ridge A',
    area_code: 'RIDGE',
    area_name: 'Ridge Side',
    sleeps: 5,
    bathroom: 'none',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    allocation_default: 'family_pool',
    reservation_state: null,
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

describe('UnitInventoryPanel', () => {
  it('keeps staff-reserved units visible and badges them', () => {
    render(
      <UnitInventoryPanel
        units={[
          unit(),
          unit({
            unit_id: 'u2',
            code: 'le-shack',
            name: 'Le Shack',
            reservation_state: 'reserved_staff',
            is_family_available: false,
          }),
        ]}
      />
    )
    expect(screen.getByText('Le Shack')).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  it('badges a maintenance hold differently from a staff hold', () => {
    render(
      <UnitInventoryPanel
        units={[unit({ reservation_state: 'reserved_other', is_family_available: false })]}
      />
    )
    expect(screen.getByText('Held')).toBeInTheDocument()
  })

  it('badges a released staff cabin as released', () => {
    render(
      <UnitInventoryPanel
        units={[
          unit({
            allocation_default: 'staff_default',
            reservation_state: 'released_to_family',
            is_family_available: true,
          }),
        ]}
      />
    )
    expect(screen.getByText('Released')).toBeInTheDocument()
  })

  it('renders unknown capacity as an em dash, never as zero', () => {
    render(<UnitInventoryPanel units={[unit({ sleeps: null })]} />)
    expect(screen.getByText('Sleeps —')).toBeInTheDocument()
    expect(screen.queryByText('Sleeps 0')).not.toBeInTheDocument()
  })

  it('marks container rows as buildings, not bookable rooms', () => {
    render(
      <UnitInventoryPanel
        units={[unit({ unit_id: 'u3', code: 'gt-wawona', name: 'Wawona', is_container: true })]}
      />
    )
    expect(screen.getByText('Building')).toBeInTheDocument()
  })

  it('badges the individual cabins whose amenities are unconfirmed', () => {
    render(
      <UnitInventoryPanel
        units={[unit({ is_confirmed: false }), unit({ unit_id: 'u9', name: 'Ridge Z' })]}
      />
    )
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument()
  })

  it('states it once, not per row, when nothing in the registry is confirmed', () => {
    // 82 of 82 cabins are unconfirmed in 2026; a badge on every row stops
    // being read, and the banner already reports the same fact.
    render(
      <UnitInventoryPanel
        units={[
          unit({ is_confirmed: false }),
          unit({ unit_id: 'u9', name: 'Ridge Z', is_confirmed: false }),
        ]}
      />
    )
    expect(screen.getByText('No amenities confirmed yet')).toBeInTheDocument()
    expect(screen.queryByText('Unconfirmed')).not.toBeInTheDocument()
  })

  it('groups units by area', () => {
    render(
      <UnitInventoryPanel
        units={[
          unit(),
          unit({
            unit_id: 'u4',
            code: 'river-a',
            name: 'River A',
            area_code: 'RIVER',
            area_name: 'River Side',
          }),
        ]}
      />
    )
    expect(screen.getByText('Ridge Side')).toBeInTheDocument()
    expect(screen.getByText('River Side')).toBeInTheDocument()
  })

  it('keeps every unit of an area together under one heading', () => {
    render(
      <UnitInventoryPanel
        units={[
          unit(),
          unit({
            unit_id: 'u5',
            code: 'river-a',
            name: 'River A',
            area_code: 'RIVER',
            area_name: 'River Side',
          }),
          unit({ unit_id: 'u6', code: 'ridge-b', name: 'Ridge B' }),
        ]}
      />
    )
    expect(screen.getAllByText('Ridge Side')).toHaveLength(1)
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
    expect(screen.getByText('Ridge B')).toBeInTheDocument()
  })

  it('keeps areas apart when they share a blank code but not a name', () => {
    // An area row carrying a name and no code is possible — the API sends
    // `code: ""` for anything it cannot resolve. Bucketing on the code alone
    // then files the second area's cabins under the first area's heading and
    // discards its name entirely.
    render(
      <UnitInventoryPanel
        units={[
          unit({ area_code: '', area_name: 'Ridge Side' }),
          unit({
            unit_id: 'u7',
            code: 'river-a',
            name: 'River A',
            area_code: '',
            area_name: 'River Side',
          }),
        ]}
      />
    )
    expect(screen.getByText('Ridge Side')).toBeInTheDocument()
    expect(screen.getByText('River Side')).toBeInTheDocument()
  })

  it('explains an empty registry instead of rendering a bare panel', () => {
    render(<UnitInventoryPanel units={[]} />)
    expect(screen.getByText(/No lodging units in the registry yet/)).toBeInTheDocument()
  })
})
