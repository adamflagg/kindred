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
    inventory_class: 'family_pool',
    shareability: 'single_party',
    family_available_override: null,
    reason: '',
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
    },
  }
}

function mapUnit(unit: LodgingUnitRow, parties: RosterPartyRow[] = []): MapUnit {
  return {
    unit,
    parties,
    consent: null,
    hue: 'hsl(160 45% 42%)',
    // What `buildMapModel` computes for an ORDINARY room (kindred#2183) — one
    // room, its own capacity. A combined house overrides both; see the
    // container tests at the foot of this file.
    roomCount: 1,
    capacity: unit.sleeps ?? null,
    x: 0.4,
    y: 0.5,
  }
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

  it('names the occupant by its attending adults, not a mismatched salutation', () => {
    // kindred#2084: `display_name` is CampMinder's mailing_title, which
    // disagreed with the real attending-adult list on 26.7% of 2026's
    // rostered households. This reuses FamilyCard's own construction
    // (`householdIdentity.ts`) instead of the salutation.
    const johnson = party('Mr. and Mrs. Johnson')
    johnson.adults = [
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
      { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
    ]
    render(<MapUnitPopover units={[mapUnit(row(), [johnson])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Emma Johnson · David Johnson' })).toBeInTheDocument()
    expect(screen.queryByText('Mr. and Mrs. Johnson')).not.toBeInTheDocument()
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
        units={[
          mapUnit(
            row({
              family_available_override: false,
              reason: 'Burst pipe',
              is_family_available: false,
            })
          ),
        ]}
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

  it('names the unmet occupant by its attending adults too', () => {
    const needsPower = party('Mr. and Mrs. Johnson')
    needsPower.adults = [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }]
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    }
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_confirmed: true, has_power: false }), [needsPower])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/Emma Johnson — No power/)).toBeInTheDocument()
    expect(screen.queryByText(/Mr\. and Mrs\. Johnson/)).not.toBeInTheDocument()
  })

  it('does not accuse an UNCONFIRMED cabin of failing a request', () => {
    const needsPower = party('Johnson')
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
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

describe('MapUnitPopover — shareability (kindred#2026)', () => {
  // This popover is the ONE surface that already prints `shared by N`. Saying a
  // room is shared by two while saying nothing about whether it MAY be is the
  // drift `unitBadges`' header exists to prevent ("shared by the board's slot
  // cards and the map's unit popover so the two cannot drift").

  it('says a unit may take a second family', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ shareability: 'shareable' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Shared OK')).toBeInTheDocument()
  })

  it('flags an unclassified unit rather than letting silence read as safe', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ shareability: 'unknown' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Sharing unset')).toBeInTheDocument()
  })

  it('stays silent on a one-family room, exactly as the board card does', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
  })

  it('shows BOTH the occupancy fact and the permission on a shared room', () => {
    // The pairing is the point: `shared by 2` reports what IS, the chip reports
    // what is ALLOWED. A staffer seeing the first without the second cannot
    // tell a legitimate share from a double-booking.
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ shareability: 'single_party' }), [party('Johnson'), party('Garcia')]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/shared by 2/)).toBeInTheDocument()
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
    // entirely — it belongs in the header instead. That header is now the
    // master summary's, not the grid's own (kindred#2183); the rule it
    // encodes is unchanged, only where the name is said once.
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
  })

  it('leaves unrelated cabin names alone', () => {
    const scattered = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'birch-2', name: 'Birch 2' })),
    ]
    render(<MapUnitPopover units={scattered} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Birch 2')).toBeInTheDocument()
    // No shared prefix means no stray building name in the header either —
    // the summary falls back to the room count.
    expect(screen.getByText('2 rooms')).toBeInTheDocument()
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

  it('labels a cluster cell by attending adults, not a mismatched salutation', () => {
    // kindred#2084, same construction as the single-room DetailCard above.
    const johnson = party('Mr. and Mrs. Johnson')
    johnson.adults = [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }]
    const cluster = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [johnson]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={cluster} hue={HUE} onOpenParty={vi.fn()} />)
    // Scoped to the CELL: the master summary above it names the same people
    // (kindred#2183), so an unscoped `getByText` now matches two elements and
    // would fail for a reason that has nothing to do with the salutation.
    expect(screen.getAllByTestId('map-popover-cell')[0]).toHaveTextContent('Emma Johnson')
    expect(screen.queryByText(/Mr\. and Mrs\. Johnson/)).not.toBeInTheDocument()
  })

  const units = [
    mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Johnson')]),
    mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    mapUnit(row({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' })),
  ]

  it('summarises how many rooms and how many are taken', () => {
    // Said once, in the master summary, since kindred#2183 — the grid's own
    // duplicate header went with it. The building name these three share
    // ("Cedar") leads the summary; the counts follow.
    render(<MapUnitPopover units={units} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar')).toBeInTheDocument()
    expect(screen.getByText('3 · 1 taken, 2 open')).toBeInTheDocument()
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
          family_available_override: false,
          is_family_available: false,
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

/**
 * kindred#2183 — the container's peek. Before this, `units.length === 1`
 * chose between a rich `DetailCard` and a bare `FootprintGrid`, so a
 * multi-room building could NEVER show the good card: its cells carried a
 * family label and nothing else. The owner's ruling replaced the either/or
 * with master-detail — a summary over every room, the grid beneath it as a
 * spatial picker, and today's single-room card reachable from a cell.
 */
describe('MapUnitPopover — a container, master-detail (kindred#2183)', () => {
  /** Distinct `household_cm_id`s, so `partyKey` tells the families apart. */
  function family(
    cmId: number,
    salutation: string,
    adults: string[],
    children: string[] = []
  ): RosterPartyRow {
    const base = party(salutation)
    base.household_cm_id = cmId
    base.adults = adults.map((name, index) => ({
      adult_number: index + 1,
      display_name: name,
      relationship: '',
    }))
    base.children = children.map((name) => ({
      person_cm_id: 0,
      display_name: name,
      age: 8,
      grade: 3,
    }))
    return base
  }

  /**
   * The SUMMARY's chip for the Garcias, not the grid cell that also names
   * them: a cell's accessible name lists its occupants too, so a role query
   * matches both.
   */
  function garciaChip(): HTMLElement {
    const chip = screen
      .getAllByTestId('map-popover-family')
      .find((node) => node.textContent.includes('Sofia Garcia'))
    if (!chip) throw new Error('no family chip for the Garcias')
    return chip
  }

  const JOHNSON = family(
    9001,
    'The Johnsons',
    ['Dana Johnson', 'Marcus Johnson'],
    ['Emma Johnson', 'Noah Johnson']
  )
  const GARCIA = family(9002, 'The Garcias', ['Sofia Garcia'])

  const HOUSE = [
    mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back', sleeps: 4 }), [
      JOHNSON,
    ]),
    mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft', sleeps: 2 }), [
      GARCIA,
    ]),
    mapUnit(row({ unit_id: 'u3', code: 'cedar-side', name: 'Cedar Lodge Side', sleeps: 3 })),
  ]

  it('summarises the whole building above the grid, rather than only the cells', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    // The building name the cells no longer carry.
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
    expect(screen.getByText('Rooms')).toBeInTheDocument()
    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
    // The grid is still there — it is the cluster disambiguator, not decoration.
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)
  })

  it('lists every PERSON housed in the building, grouped one chip per family', () => {
    // The owner's ask verbatim: not a family label, the people. Adults and
    // children alike — a chip that named only the grown-ups would answer
    // "who is housed here" with half the household.
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    expect(
      screen.getByRole('button', {
        name: 'Dana Johnson · Marcus Johnson · Emma Johnson · Noah Johnson',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sofia Garcia' })).toBeInTheDocument()
    // The salutation is never the identity — kindred#2084's rule, inherited.
    expect(screen.queryByText(/The Johnsons/)).not.toBeInTheDocument()
  })

  it('opens the family panel when a family chip is clicked', async () => {
    const onOpenParty = vi.fn()
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={onOpenParty} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sofia Garcia' }))
    expect(onOpenParty).toHaveBeenCalledWith(GARCIA)
  })

  it('totals the building’s beds and says how many are spoken for', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    // 4 + 2 + 3 beds; both parties report `party_size: 3`.
    expect(screen.getByText('9 · 6 placed')).toBeInTheDocument()
  })

  it('counts a family holding two rooms once, not once per room', () => {
    // ONE TOGGLE AWAY on the 2026 registry, not hypothetical. A household is
    // already let across two adjacent rooms of one house as a single merged
    // placement, and `indexPayload` puts a multi-room party on EVERY room it
    // occupies — "A party holding several rooms appears on each of them",
    // which is what stops the second room rendering empty. It does not double
    // today only because that house is drawn COMBINED, so the two rooms are
    // one card; splitting it is a scenario toggle staff have already used on
    // another house this year, and the rooms are close enough to cluster
    // under one pin, which makes this peek exactly what opens over it.
    //
    // The chip list already dedupes by `partyKey`; the bed total must too, or
    // the summary contradicts itself — one family, twice its beds, and a
    // "placed" figure that can exceed the building's own capacity.
    const spread = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back', sleeps: 2 }), [
        JOHNSON,
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft', sleeps: 3 }), [
        JOHNSON,
      ]),
    ]
    render(<MapUnitPopover units={spread} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-family')).toHaveLength(1)
    // 2 + 3 beds; ONE household of 3, however many doors it is behind.
    expect(screen.getByText('5 · 3 placed')).toBeInTheDocument()
  })

  it('refuses a building total when one of its rooms is unmeasured', () => {
    const partial = [HOUSE[0], mapUnit(row({ unit_id: 'u9', code: 'cedar-x', sleeps: null }))]
    render(<MapUnitPopover units={partial as MapUnit[]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/unknown/i)).toBeInTheDocument()
    expect(screen.queryByText(/^4 · /)).not.toBeInTheDocument()
  })

  it('carries a flagged room’s consent warning onto the family chip, in words', () => {
    // A cluster mark rings amber if ANY member is flagged. The summary is the
    // first thing a staff member reads, so the warning has to survive into it
    // — and as TEXT, because colour alone is not a signal (WCAG 1.4.1).
    const withFlag = [
      flagged(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' }), [
        JOHNSON,
        GARCIA,
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={withFlag} hue={HUE} onOpenParty={vi.fn()} />)
    expect(garciaChip()).toHaveTextContent(/sharing not consented/i)
  })

  it('leaves an unflagged family chip free of the consent warning', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    expect(garciaChip()).not.toHaveTextContent(/sharing not consented/i)
  })

  it('says a whole empty building is empty rather than listing nobody', () => {
    const vacant = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={vacant} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
    // Exact, not `/empty/i`: each cell carries its own sr-only " — empty",
    // and this is asserting the SUMMARY says so once for the building.
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('map-popover-family')).toHaveLength(0)
  })

  it('swaps the detail to one room when its cell is picked, and back again', async () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    // Today's single-room DetailCard, now reachable from a container.
    expect(screen.getByText('Cedar Lodge Loft')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
    expect(screen.queryByText('3 · 2 taken, 1 open')).not.toBeInTheDocument()
    // The grid stays put — it is the picker, and picking must not remove it.
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: '← All of Cedar Lodge' }))
    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
  })

  it('falls back to the summary when the picked room leaves the cluster', async () => {
    // The popover is reconciled by POSITION, so a refetch that dissolves this
    // cluster and mints another would otherwise leave a room selected that is
    // no longer under the pin. Same latch shape as `LodgingMap`'s pinned key.
    const { rerender } = render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    expect(screen.getByText('Cedar Lodge Loft')).toBeInTheDocument()

    const elsewhere = [
      mapUnit(row({ unit_id: 'z1', code: 'birch-1', name: 'Birch 1' })),
      mapUnit(row({ unit_id: 'z2', code: 'birch-2', name: 'Birch 2' })),
    ]
    rerender(<MapUnitPopover units={elsewhere} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← All of/ })).not.toBeInTheDocument()
  })

  it('does not restore the old pick when the original cluster comes back', async () => {
    // The other half of the latch above. Falling back to the summary while the
    // room is absent is not enough on its own: the id is still in state, so
    // clicking pin A, then pin B, then pin A again re-applies it and room 2's
    // card reappears under a click that only asked for the building. That is
    // the same "a view reopens with no click" defect `LodgingMap` fixed for
    // its own pinned/dwell keys (kindred#2137 bug 4), one level in.
    const elsewhere = [
      mapUnit(row({ unit_id: 'z1', code: 'birch-1', name: 'Birch 1' })),
      mapUnit(row({ unit_id: 'z2', code: 'birch-2', name: 'Birch 2' })),
    ]
    const { rerender } = render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    rerender(<MapUnitPopover units={elsewhere} hue={HUE} onOpenParty={vi.fn()} />)
    rerender(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)

    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← All of/ })).not.toBeInTheDocument()
  })

  it('still shows a lone room as a plain detail card, with no grid or summary', () => {
    render(<MapUnitPopover units={[mapUnit(row(), [JOHNSON])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryAllByTestId('map-popover-cell')).toHaveLength(0)
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument()
  })

  it('names the whole family on a lone room too, not only its adults', () => {
    render(<MapUnitPopover units={[mapUnit(row(), [JOHNSON])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(
      screen.getByRole('button', {
        name: 'Dana Johnson · Marcus Johnson · Emma Johnson · Noah Johnson',
      })
    ).toBeInTheDocument()
  })

  it('reports a combined house’s WHOLE capacity, not its landing-futon delta', () => {
    // kindred#2041: a container's own `sleeps` is a DELTA over its rooms. The
    // map draws a combined house as ONE mark, so its peek is a lone
    // `DetailCard` — reading the raw delta there understates a four-room
    // house as sleeping one. `buildMapModel` resolves the whole-house figure;
    // this card must read THAT.
    const house = mapUnit(
      row({
        unit_id: 'h0',
        code: 'cedar-house',
        name: 'Cedar House',
        is_container: true,
        sleeps: 1,
      })
    )
    render(
      <MapUnitPopover
        units={[{ ...house, roomCount: 4, capacity: 9 }]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })
})
