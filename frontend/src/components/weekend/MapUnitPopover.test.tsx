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

/** A room whose sharing nobody consented to — what #1926 exists to surface. */
function flagged(unit: LodgingUnitRow, parties: RosterPartyRow[]): MapUnit {
  return {
    ...mapUnit(unit, parties),
    consent: {
      declinedCount: 1,
      unansweredCount: 0,
      conflictCount: 0,
      reason: '1 family did not request sharing',
    },
  }
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

  it('badges a held room, reusing the inventory and board wording', () => {
    // `reservationBadge` is the shared source for this; a second copy is how
    // the three surfaces start disagreeing about what "Held" means.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ reservation_state: 'reserved_other' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Held')).toBeInTheDocument()
  })

  it('says a deactivated room is inactive', () => {
    // It only reaches the board at all because somebody is still in it —
    // `boardLayout`'s own comment: "hiding it would drop them."
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_active: false }), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('says when nobody has confirmed the room amenities', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_confirmed: false }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument()
  })

  it('lists the amenities the registry records', () => {
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ bathroom: 'private', has_power: true, has_ac: true, is_accessible: true })),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Private bathroom')).toBeInTheDocument()
    expect(screen.getByLabelText('Power')).toBeInTheDocument()
    expect(screen.getByLabelText('Air conditioning')).toBeInTheDocument()
    expect(screen.getByLabelText('Accessible')).toBeInTheDocument()
  })

  it('reports beds needed against the capacity', () => {
    // `party_size` over-counts adults (all household adults are added whether
    // or not they attend), so this is a sizing hint, not a verdict.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ sleeps: 4 }), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('3 of 4')).toBeInTheDocument()
  })

  it('flags an occupant whose confirmed cabin does not answer their request', () => {
    // Reuses `partyAttention`, which already encodes the rule that only a
    // CONFIRMED cabin is evidence — an unset `has_power` means "nobody has
    // said", not "there is no power".
    const needsPower = party('Johnson')
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    }
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_confirmed: true, has_power: false }), [needsPower])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/No power/)).toBeInTheDocument()
  })

  it('does not accuse an UNCONFIRMED cabin of failing a request', () => {
    const needsPower = party('Johnson')
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    }
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_confirmed: false, has_power: false }), [needsPower])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText(/No power/)).not.toBeInTheDocument()
  })

  it('prints the consent reason, as the board card does', () => {
    // The board renders `consent.reason` verbatim beside the slot. The map
    // carries the identical flag off the same slot, so the peek must say the
    // same thing rather than showing an ordinary shared room.
    render(
      <MapUnitPopover
        units={[flagged(row(), [party('Johnson'), party('Garcia')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('1 family did not request sharing')).toBeInTheDocument()
  })

  it('gives two occupants distinct keys even when the payload omits both ids', () => {
    // `household_cm_id` / `person_cm_id` are optional on the generated type, so
    // an omission is reachable through the schema even though the API's own
    // contract says exactly one is non-zero. Keyed on the ids alone both
    // occupants collapse to `household-undefined` and React reconciles two
    // different families as one row. The shared `partyKey` falls back to the
    // display name; every surface that lists parties inherits that.
    const anonymous = (name: string): RosterPartyRow => {
      const base = party(name)
      // `delete` rather than a rest-destructure: both fields are optional, and
      // this says "the payload omitted them" without binding two throwaway
      // names the linter then flags as unused.
      delete base.household_cm_id
      delete base.person_cm_id
      return base
    }
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [anonymous('Johnson'), anonymous('Garcia')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    const messages = warn.mock.calls.map((call) => String(call[0])).join('\n')
    warn.mockRestore()
    expect(messages).not.toMatch(/same key/i)
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
    // The tooltip carries the FULL name — it appears with no surrounding
    // context, so the shortened form would be ambiguous. Regression: a
    // shortened label leaking into `title` reads as "1 — empty", not
    // "Cedar 1 — empty".
    const first = screen.getByTitle('Cedar 1 — empty')
    expect(first).not.toHaveTextContent('Cedar 1')
    const second = screen.getByTitle('Cedar 2 — empty')
    expect(second).not.toHaveTextContent('Cedar 2')
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
    // Stripping the building name from every cell must not delete it
    // entirely — it belongs in the header instead.
    expect(screen.getByText('Cedar Lodge · 2 rooms · 0 taken')).toBeInTheDocument()
  })

  it('leaves unrelated cabin names alone', () => {
    const scattered = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'birch-2', name: 'Birch 2' })),
    ]
    render(<MapUnitPopover units={scattered} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Birch 2')).toBeInTheDocument()
    // No shared prefix means no stray building name in the header either.
    expect(screen.getByText('2 rooms · 0 taken')).toBeInTheDocument()
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

  it('carries a held or deactivated room’s status into the cluster cell', () => {
    // The grid has no room for badges, but a cell that says nothing makes a
    // held room in a house indistinguishable from a bookable one. The tooltip
    // is free space.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          reservation_state: 'reserved_other',
          is_active: false,
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByTitle(/Cedar 2.*Held.*Inactive/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/Cedar 1.*Held/i)).not.toBeInTheDocument()
  })

  it('says WHICH room in a cluster carries the consent flag', () => {
    // A cluster mark rings amber if ANY member is flagged, which on a
    // four-room house narrows it to four. The grid is where that resolves to
    // one room, so the flag has to survive into the cell — in the tooltip as
    // well as the border, since colour alone is not a signal.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Nguyen')]),
      flagged(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' }), [
        party('Johnson'),
        party('Garcia'),
      ]),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    const flaggedCell = screen.getByTitle(/Cedar 2.*sharing not consented/i)
    expect(flaggedCell).toBeInTheDocument()
    expect(screen.queryByTitle(/Cedar 1.*sharing not consented/i)).not.toBeInTheDocument()
  })
})
