/**
 * A slot card. One unit, holding nothing, one party, or occasionally two.
 *
 * Not a summer bunk column: a bunk column is tall because it holds 10–14
 * campers. 82 rooms cannot be 82 columns.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import type { BoardSlot } from './boardLayout'
import { LodgingUnitCard } from './LodgingUnitCard'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
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

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

function slot(overrides: Partial<BoardSlot> = {}): BoardSlot {
  return { unit: unit(), parties: [], consent: null, ...overrides }
}

describe('LodgingUnitCard', () => {
  it('names the unit', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
  })

  it('renders unknown capacity as an em dash, never as zero', () => {
    // `null` is UNKNOWN. The API already maps PocketBase's stored 0 to null,
    // and "sleeps 0" is a lie about a cabin nobody has measured.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: null }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows how many spaces the unit sleeps when it is known', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByTitle(/Sleeps 5/)).toBeInTheDocument()
  })

  it('says an empty unit is empty', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('renders the families it holds', () => {
    render(
      <LodgingUnitCard
        slot={slot({ parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Johnson')).toBeInTheDocument()
    expect(screen.getByText('Garcia')).toBeInTheDocument()
  })

  it('says two parties are sharing', () => {
    render(
      <LodgingUnitCard
        slot={slot({ parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('2 families')).toBeInTheDocument()
  })

  it('flags a shared unit where a family declined', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
          consent: {
            declinedCount: 1,
            unansweredCount: 0,
            reason: '1 family declined sharing',
          },
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('1 family declined sharing')).toBeInTheDocument()
  })

  it('badges a staff hold rather than hiding the room', () => {
    // Staff reason about adjacency; hiding a held room makes the site look
    // smaller than it is.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ reservation_state: 'reserved_staff', is_family_available: false }),
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  it('carries the area hue on its top edge as a secondary channel', () => {
    // §3.10 — eight hues is at the limit of distinguishability, so this is
    // decoration over a layout that already groups by section header.
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveStyle({ borderTopColor: 'hsl(160 45% 42%)' })
  })

  it('marks an inactive unit that still holds someone', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_active: false }), parties: [party()] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })
})
