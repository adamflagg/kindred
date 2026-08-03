/**
 * The in-place peek. Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import type { MapUnit } from './mapModel'
import { MapUnitPopover } from './MapUnitPopover'

function row(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 4,
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
    map_x: 0.4,
    map_y: 0.5,
    ...overrides,
  }
}

function party(name: string): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 9001,
    person_cm_id: 0,
    display_name: name,
    adults: [],
    children: [],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    },
  }
}

function mapUnit(unit: LodgingUnitRow, parties: RosterPartyRow[] = []): MapUnit {
  return { unit, parties, consent: null, hue: 'hsl(160 45% 42%)', x: 0.4, y: 0.5 }
}

const HUE = 'hsl(160 45% 42%)'

describe('MapUnitPopover — one room', () => {
  it('names the room and its area', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
  })

  it('names the occupant', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Johnson/ })).toBeInTheDocument()
  })

  it('says a room is empty rather than leaving it blank', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/empty/i)).toBeInTheDocument()
  })

  it('never renders an unknown capacity as 0', () => {
    render(
      <MapUnitPopover units={[mapUnit(row({ sleeps: null }))]} hue={HUE} onOpenParty={vi.fn()} />
    )
    // Only the positive assertion here. A `queryByText(/sleeps 0/i)` companion
    // was removed: `dt` and `dd` are separate elements, so that string can never
    // form one text node and the assertion could not fail whatever the code did.
    expect(screen.getByText(/unknown/i)).toBeInTheDocument()
  })

  it('opens the party when its name is clicked', async () => {
    const onOpenParty = vi.fn()
    const johnson = party('Johnson')
    render(
      <MapUnitPopover units={[mapUnit(row(), [johnson])]} hue={HUE} onOpenParty={onOpenParty} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(onOpenParty).toHaveBeenCalledWith(johnson)
  })
})

describe('MapUnitPopover — a cluster of rooms', () => {
  it('does not put empty rooms in the tab order', () => {
    const empty = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={empty} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(2)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('announces an empty room as empty without relying on aria-label', () => {
    const empty = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={empty} hue={HUE} onOpenParty={vi.fn()} />)
    // Asserted as TEXT CONTENT, deliberately. An accessible-name assertion
    // would pass here even if the name were unreachable to real AT.
    for (const cell of screen.getAllByTestId('map-popover-cell')) {
      expect(cell).toHaveTextContent(/empty/i)
    }
  })

  it('drops the building name the cluster shares, so cells differ visibly', () => {
    // A browser found this: every cell read "Clouds Rest Ba…" / "Clouds Rest
    // La…" and truncated away the distinguishing word.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByText('Loft')).toBeInTheDocument()
    expect(screen.queryByText(/Cedar Lodge Back/)).not.toBeInTheDocument()
  })

  it('leaves unrelated cabin names alone', () => {
    const scattered = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'birch-2', name: 'Birch 2' })),
    ]
    render(<MapUnitPopover units={scattered} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Birch 2')).toBeInTheDocument()
  })

  it('says a room is shared rather than showing only the first family', () => {
    const shared = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [
        party('Johnson'),
        party('Garcia'),
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={shared} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Johnson +1')).toBeInTheDocument()
  })

  const units = [
    mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Johnson')]),
    mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    mapUnit(row({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' })),
  ]

  it('summarises how many rooms and how many are taken', () => {
    render(<MapUnitPopover units={units} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/3 rooms/)).toBeInTheDocument()
    expect(screen.getByText(/1 taken/)).toBeInTheDocument()
  })

  it('draws one cell per room', () => {
    render(<MapUnitPopover units={units} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)
  })
})
