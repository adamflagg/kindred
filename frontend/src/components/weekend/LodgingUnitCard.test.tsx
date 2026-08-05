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
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
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
            conflictCount: 0,
            reason: '1 family did not request sharing',
          },
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('1 family did not request sharing')).toBeInTheDocument()
  })

  it('badges a staff hold rather than hiding the room', () => {
    // Staff reason about adjacency; hiding a held room makes the site look
    // smaller than it is. The Staff badge is ROLE-driven since 1500000135 --
    // `reserved_staff` was a reason, and reasons are now free text.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ inventory_class: 'staff_default', is_family_available: false }),
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

  it('keys two adult-weekend individuals in one room apart', () => {
    // An adult weekend enrols PEOPLE, and the API sends `household_cm_id = 0`
    // for them rather than omitting it — Pydantic `int = 0`. A `??` chain
    // stops at that 0, so both occupants of a shared room key to `person-0`
    // and React reconciles them as one child. This card is the fifth party
    // lister and the one `partyKey.ts` did not reach.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [
            party({
              grain: 'person',
              household_cm_id: 0,
              person_cm_id: 1000001,
              display_name: 'Riley Sam',
            }),
            party({
              grain: 'person',
              household_cm_id: 0,
              person_cm_id: 1000002,
              display_name: 'Samuel Johnson',
            }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getByText('Riley Sam')).toBeInTheDocument()
    expect(screen.getByText('Samuel Johnson')).toBeInTheDocument()
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/i)
    errors.mockRestore()
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

describe('LodgingUnitCard — the split control belongs to containers only', () => {
  it('offers a split control on a combined CONTAINER', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ code: 'house', is_container: true, is_combined: true }) })}
        hue="hsl(160 45% 42%)"
        canMerge
        onSplit={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /^Split Cedar 1/ })).toBeInTheDocument()
  })

  it('offers NO split control on a leaf carrying a stale is_combined', () => {
    // The API resolves `is_combined` for every row, leaves included, and a
    // leaf can carry a stale `default_combined: true` — the admin form does
    // not clear it when "is a building" is unticked. Splitting a room into
    // rooms it does not have is not a thing the board can do, so the control
    // must not be there to click. The gate is the fix; clearing the stored
    // flag deliberately is not (an unticked building may be re-ticked).
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_container: false, is_combined: true }) })}
        hue="hsl(160 45% 42%)"
        canMerge
        onSplit={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /^Split Cedar 1/ })).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the per-party sharing chip follows ROOM overlap, not the card (task-11 round 1)', () => {
  // A merged container's card holds every room's parties, so `slot.parties`
  // here carries whichever leaf room each one actually occupies via
  // `unit_code`/`unit_codes` — exactly what `buildBoard`'s roll-up produces
  // for a combined building. `declinedParty` alone is not enough to chip:
  // `FamilyCard` also requires `sharedSlot`, which is what this block pins.
  function declinedParty(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
    return party({ share: { eligibility: 'declined' }, ...overrides })
  }
  const mergedHouse = unit({ code: 'house', is_container: true, is_combined: true })

  it('chips neither party when a merged card holds two DISJOINT rooms', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: mergedHouse,
          parties: [
            declinedParty({ household_cm_id: 101, display_name: 'Alpha', unit_code: 'r1' }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta', unit_code: 'r2' }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Did not request sharing')).not.toBeInTheDocument()
  })

  it('chips both parties when a merged card holds two households in the SAME room', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: mergedHouse,
          parties: [
            declinedParty({ household_cm_id: 101, display_name: 'Alpha', unit_code: 'r1' }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta', unit_code: 'r1' }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
  })

  it('chips an overlapping pair but leaves a disjoint third party unchipped', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: mergedHouse,
          parties: [
            declinedParty({
              household_cm_id: 101,
              display_name: 'Alpha',
              unit_code: '',
              unit_codes: ['r1', 'r2'],
              is_merged_slot: true,
            }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta', unit_code: 'r1' }),
            declinedParty({ household_cm_id: 103, display_name: 'Gamma', unit_code: 'r3' }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
    const gammaCard = screen.getByText('Gamma').closest('button')
    expect(gammaCard?.textContent).not.toContain('Did not request sharing')
  })

  it('chips both when one party names the CONTAINER and the other a room beneath it', () => {
    // A party on the building occupies every room in it, so it shares `r1`
    // with the party named there. Comparing the raw codes puts `'house'`
    // beside `'r1'` and finds nothing — the expansion is what makes this a
    // comparison of rooms, and it needs the registry, hence `units`.
    const rooms = [
      mergedHouse,
      unit({ unit_id: 'u2', code: 'r1', name: 'Room 1', parent_code: 'house' }),
      unit({ unit_id: 'u3', code: 'r2', name: 'Room 2', parent_code: 'house' }),
    ]
    render(
      <LodgingUnitCard
        slot={slot({
          unit: mergedHouse,
          parties: [
            declinedParty({ household_cm_id: 101, display_name: 'Alpha', unit_code: 'house' }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta', unit_code: 'r1' }),
          ],
        })}
        units={rooms}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
  })

  it('leaves a container party unchipped against a room it does NOT cover', () => {
    // The expansion must not turn every container placement into a share.
    // `other` is a sibling building, so `house`'s rooms and `other`'s room
    // are disjoint and neither party is chipped.
    const rooms = [
      mergedHouse,
      unit({ unit_id: 'u2', code: 'r1', name: 'Room 1', parent_code: 'house' }),
      unit({ unit_id: 'u3', code: 'other', name: 'Other', is_container: true }),
      unit({ unit_id: 'u4', code: 'r9', name: 'Room 9', parent_code: 'other' }),
    ]
    render(
      <LodgingUnitCard
        slot={slot({
          unit: mergedHouse,
          parties: [
            declinedParty({ household_cm_id: 101, display_name: 'Alpha', unit_code: 'house' }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta', unit_code: 'r9' }),
          ],
        })}
        units={rooms}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Did not request sharing')).not.toBeInTheDocument()
  })

  it('still chips both parties on a plain leaf slot in the same room', () => {
    // Not a merged card at all -- proves the ordinary, pre-existing case is
    // unbroken by moving `sharedSlot` from the card to the room.
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [
            declinedParty({ household_cm_id: 101, display_name: 'Alpha' }),
            declinedParty({ household_cm_id: 102, display_name: 'Beta' }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
  })
})
