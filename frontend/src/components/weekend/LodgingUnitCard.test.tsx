/**
 * A slot card. One unit, holding nothing, one party, or occasionally two.
 *
 * Not a summer bunk column: a bunk column is tall because it holds 10–14
 * campers. 82 rooms cannot be 82 columns.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import type { BoardSlot } from './boardLayout'
import { mergeDragId, unitDroppableId } from './dragPlacement'
import { LodgingUnitCard } from './LodgingUnitCard'

/**
 * jsdom cannot perform a pointer drag, so `useDroppable`'s real `isOver`
 * never goes true here. The settled idiom (`LodgingBoard.drag.test.tsx`) is
 * to mock at the `@dnd-kit/core` boundary; this one only needs `isOver`
 * itself, controlled by `overDroppableId`, to prove the drop-target state
 * outranks the shared-space ring below. `useDraggable` stays real — the
 * merge-handle tests click a plain `onClick`, which does not touch it.
 */
let overDroppableId: string | null = null

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useDroppable: (args: { id: string; disabled?: boolean }) => ({
      setNodeRef: vi.fn(),
      isOver: args.disabled !== true && args.id === overDroppableId,
    }),
  }
})

beforeEach(() => {
  overDroppableId = null
})

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
    shareability: 'single_party',
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
    /*
     * `null` is UNKNOWN. The API already maps PocketBase's stored 0 to null,
     * and "sleeps 0" is a lie about a cabin nobody has measured.
     *
     * The figure became `occupancy/capacity`, so the em dash is now the
     * DENOMINATOR rather than the whole string. The claim is unchanged and is
     * the point of the second assertion: an empty unmeasured room reads
     * `0/—`, never `0/0`.
     */
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: null }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('0/—')).toBeInTheDocument()
    expect(screen.queryByText('0/0')).not.toBeInTheDocument()
  })

  it('shows how many spaces the unit sleeps when it is known', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByTitle(/Sleeps 5/)).toBeInTheDocument()
  })

  it('invites a drop into an empty unit while placement is live', () => {
    // Summer's wording, in family vocabulary: `BunkCard` says "Drop campers
    // here". The card's job in an empty slot is to be a target, and "Empty"
    // described the state without offering the action.
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" canPlace onOpenParty={vi.fn()} />)
    expect(screen.getByText('Drop families here')).toBeInTheDocument()
  })

  it('says an empty unit is empty when nothing can be dropped', () => {
    /*
     * Without a scenario, or without `bunking.manage`, there is nothing to
     * drop and no way to drop it — so the invitation would name an action the
     * reader cannot take. Summer reaches the same conclusion and renders
     * NOTHING in production mode (`BunkCard`: `!isProductionMode && …`); these
     * cards are small enough that a blank body reads as a broken card rather
     * than a read-only one, so the state gets stated instead.
     */
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.queryByText('Drop families here')).not.toBeInTheDocument()
  })

  it('renders the families it holds', () => {
    // kindred#2074 removed the household salutation from the card -- it
    // leads with the children instead, so two parties need DISTINCT
    // children to stay distinguishable here (the default fixture's child
    // is 'Noah Johnson' regardless of which household overrides display_name).
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [
            party(),
            party({
              household_cm_id: 102,
              display_name: 'Garcia',
              children: [{ person_cm_id: 9002, display_name: 'Liam Garcia', age: 6, grade: 0 }],
            }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/Noah Johnson/)).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
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

  it('keeps an empty unit dashed and washed out', () => {
    // Pre-existing behaviour, preserved through the ordered-switch refactor
    // below rather than displaced by it.
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveClass('bg-muted/25')
    expect(card).toHaveClass('border-dashed')
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

describe('LodgingUnitCard — the merge handle is reachable without a pointer', () => {
  // Merging is a DRAG, and the board registers only Mouse and Touch sensors,
  // so the handle is a focusable button carrying dnd-kit's
  // `aria-roledescription="draggable"` that does nothing when a keyboard
  // activates it — while its inverse, Split, is an ordinary button that
  // works. Activating the handle is unambiguous without a drop target:
  // merging is promotion to the parent, and every sibling drop resolves to
  // that same parent, so the click path and the drag path ask for the
  // identical write.
  const room = unit({ code: 'r1', parent_code: 'wing' })

  it('merges into the parent when the handle is activated rather than dragged', async () => {
    const onMerge = vi.fn()
    render(
      <LodgingUnitCard
        slot={slot({ unit: room })}
        hue="hsl(160 45% 42%)"
        canMerge
        onMerge={onMerge}
        onOpenParty={vi.fn()}
      />
    )

    await userEvent.click(screen.getByTestId('merge-handle-r1'))
    expect(onMerge).toHaveBeenCalledWith(room)
  })

  it('refuses the activation while a merge write is already in flight', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: room })}
        hue="hsl(160 45% 42%)"
        canMerge
        savingMerge
        onMerge={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('merge-handle-r1')).toBeDisabled()
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
            declinedParty({
              household_cm_id: 101,
              display_name: 'Alpha',
              unit_code: 'r1',
              // kindred#2074: the card leads with the children now, and
              // `declinedParty`/`party()`'s default child is 'Noah Johnson'
              // regardless of display_name -- distinct children are what
              // make Alpha and Beta distinguishable below.
              children: [{ person_cm_id: 9101, display_name: 'Ivy Alpha', age: 7, grade: 1 }],
            }),
            declinedParty({
              household_cm_id: 102,
              display_name: 'Beta',
              unit_code: 'r2',
              children: [{ person_cm_id: 9102, display_name: 'Leo Beta', age: 9, grade: 3 }],
            }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/Ivy Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Leo Beta/)).toBeInTheDocument()
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
            declinedParty({
              household_cm_id: 103,
              display_name: 'Gamma',
              unit_code: 'r3',
              // kindred#2074: located by child name below, since the card no
              // longer renders the household salutation.
              children: [{ person_cm_id: 9103, display_name: 'Mia Gamma', age: 5, grade: 0 }],
            }),
          ],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
    const gammaCard = screen.getByText(/Mia Gamma/).closest('button')
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

describe('LodgingUnitCard — the whole-building mark (#2008)', () => {
  // A halved house: `upstairs`/`downstairs` are DIFFERENT buildings under
  // the immediate-parent grain ruled on #2008, even though both share the
  // `house` root.
  const halvedHouseUnits = [
    unit({ unit_id: 'up', code: 'upstairs', is_container: true }),
    unit({ unit_id: 'down', code: 'downstairs', is_container: true }),
    unit({ unit_id: 'r1', code: 'up-r1', parent_code: 'upstairs' }),
    unit({ unit_id: 'r2', code: 'up-r2', parent_code: 'upstairs' }),
  ]
  const combinedUpstairs = unit({
    unit_id: 'up',
    code: 'upstairs',
    name: 'Upstairs',
    is_container: true,
    is_combined: true,
  })

  it('marks a party whose own unit_codes cover the whole card it is drawn on', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: combinedUpstairs,
          parties: [
            party({
              household_cm_id: 101,
              unit_code: 'upstairs',
              unit_codes: ['upstairs'],
            }),
          ],
        })}
        units={halvedHouseUnits}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Whole building')).toBeInTheDocument()
  })

  it('does not mark a party holding only one room of a two-room half', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ code: 'up-r1', parent_code: 'upstairs' }),
          parties: [party({ household_cm_id: 101, unit_code: 'up-r1', unit_codes: ['up-r1'] })],
        })}
        units={halvedHouseUnits}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })

  it('does not mark either of two households splitting a combined card between disjoint rooms', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: combinedUpstairs,
          parties: [
            party({
              household_cm_id: 101,
              display_name: 'Alpha',
              unit_code: 'up-r1',
              children: [{ person_cm_id: 9101, display_name: 'Ivy Alpha', age: 7, grade: 1 }],
            }),
            party({
              household_cm_id: 102,
              display_name: 'Beta',
              unit_code: 'up-r2',
              children: [{ person_cm_id: 9102, display_name: 'Leo Beta', age: 9, grade: 3 }],
            }),
          ],
        })}
        units={halvedHouseUnits}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the shared-space mark (#2091)', () => {
  // The master housing sheet's fill for "two families here", adopted as the
  // ring `LodgingMap.tsx`'s `halo` already draws for the identical flag
  // (`0 0 0 4.5px ${hue}` there, on a small circular mark; this card is a
  // rectangle with its own 2px `.card-lodge` border, so `2px` is the ring
  // weight rather than the map's offset-plus-ring pair).
  const hue = 'hsl(160 45% 42%)'
  const sharedParties = [party(), party({ household_cm_id: 102, display_name: 'Garcia' })]
  const declinedConsent = {
    declinedCount: 1,
    unansweredCount: 0,
    conflictCount: 0,
    reason: '1 family did not request sharing',
  }

  function card(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[data-unit-card]')
    if (!el) throw new Error('no card rendered')
    return el as HTMLElement
  }

  // `.card-lodge`'s own elevation shadow (`index.css:440-443`), pinned here
  // independently of the implementation's own constant name — this is the
  // exact value a shared card must NOT lose (review finding 1 on #2119).
  const cardElevationShadow =
    '0 1px 2px hsl(var(--shadow-color) / 0.06), 0 4px 16px hsl(var(--shadow-color) / 0.08)'

  it('rings a shared unit in the area hue AND keeps the card elevation shadow', () => {
    // An inline `boxShadow` beats `.card-lodge`'s own stylesheet box-shadow
    // for the same property outright — setting ONLY the ring here (as the
    // code did before this fix) silently drops the elevation every other
    // card keeps, so a shared card reads as flat against its neighbours.
    // The fix composes both shadows into the one inline value rather than
    // letting the ring replace the elevation.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: sharedParties })} hue={hue} onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveStyle({
      boxShadow: `0 0 0 2px ${hue}, ${cardElevationShadow}`,
    })
  })

  it('leaves a single-party unit without the shared ring', () => {
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: [party()] })} hue={hue} onOpenParty={vi.fn()} />
    )
    expect(card(container)).not.toHaveStyle({ boxShadow: `0 0 0 2px ${hue}` })
  })

  it('leaves an empty unit without the shared ring', () => {
    const { container } = render(<LodgingUnitCard slot={slot()} hue={hue} onOpenParty={vi.fn()} />)
    expect(card(container)).not.toHaveStyle({ boxShadow: `0 0 0 2px ${hue}` })
  })

  it('promotes the consent ring to ring-2', () => {
    // Prerequisite named in #2091: the mark this test file is otherwise
    // about needs a `ring-1` consent edge promoted first, so the new mark
    // has a weight to lose to.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties, consent: declinedConsent })}
        hue={hue}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('ring-2')
    expect(card(container)).not.toHaveClass('ring-1')
  })

  it('lets the consent flag outrank the shared-space ring', () => {
    // Amber supersedes the hue ring, exactly as `LodgingMap.tsx`'s `halo`
    // does for the same two flags — a consent flag only ever exists on a
    // shared room, so the two never compete for meaning, only for the one
    // ring a card can draw.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties, consent: declinedConsent })}
        hue={hue}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-amber-400')
    expect(card(container)).not.toHaveStyle({ boxShadow: `0 0 0 2px ${hue}` })
  })

  it('lets an active drop target outrank the shared-space ring', () => {
    // The hue ring lives OUTSIDE the Tailwind class switch as an inline
    // `boxShadow` (`hue` is a runtime value), so nothing in the class
    // cascade stops it from fighting the drop-target ring's own box-shadow
    // — only the explicit precedence below does.
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-primary')
    expect(card(container)).not.toHaveStyle({ boxShadow: `0 0 0 2px ${hue}` })
  })

  it('lets an invalid merge target outrank the shared-space ring', () => {
    const room = unit({ code: 'cedar-1', parent_code: 'east-wing' })
    const draggedSibling = unit({ code: 'other-1', parent_code: 'west-wing' })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: room, parties: sharedParties })}
        hue={hue}
        mergeSourceUnit={draggedSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('opacity-40')
    expect(card(container)).not.toHaveStyle({ boxShadow: `0 0 0 2px ${hue}` })
  })

  it('lets an active drop target outrank a CONSENT-flagged room too', () => {
    // The existing "outranks the shared-space ring" test above only ever
    // combines an active drop target with `sharedParties` (no `consent`).
    // Consent has its own ring (`border-amber-400`), which is what a drop
    // target actually has to fight over the shared CSS slot with here.
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties, consent: declinedConsent })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-primary')
    expect(card(container)).not.toHaveClass('border-amber-400')
  })

  it('treats a merge-handle drop (isMergeOver) as an active drop target on its own', () => {
    // Isolates `isMergeOver` from `isUnitOver`: no `canPlace`, so the party
    // droppable never activates, and no party is being dragged either. Only
    // the merge droppable is over. If `isUnitOver || isMergeOver` ever lost
    // its `isMergeOver` half, this card would fall all the way through to
    // the empty-room dashed state instead of the drop-target ring.
    const room = unit({ code: 'cedar-1', parent_code: 'east-wing' })
    const validSibling = unit({ code: 'other-1', parent_code: 'east-wing' })
    overDroppableId = mergeDragId('cedar-1')
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: room })}
        hue={hue}
        mergeSourceUnit={validSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-primary')
  })

  it('keeps the consent amber accent visible while an invalid merge drag dims the card', () => {
    // Pre-existing (pre-refactor) behaviour this PR's ordered `cardState`
    // switch silently dropped: dimming and the consent ring are ORTHOGONAL
    // CSS properties (opacity/pointer-events vs border-color/box-shadow), so
    // an invalid merge target should not blank out a real consent warning —
    // it just dims the whole card, warning included.
    const room = unit({ code: 'cedar-1', parent_code: 'east-wing' })
    const draggedSibling = unit({ code: 'other-1', parent_code: 'west-wing' })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: room, parties: sharedParties, consent: declinedConsent })}
        hue={hue}
        mergeSourceUnit={draggedSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('opacity-40')
    expect(card(container)).toHaveClass('border-amber-400')
  })

  it('keeps the empty-room dashed cue visible while an invalid merge drag dims the card', () => {
    const room = unit({ code: 'cedar-1', parent_code: 'east-wing' })
    const draggedSibling = unit({ code: 'other-1', parent_code: 'west-wing' })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: room })}
        hue={hue}
        mergeSourceUnit={draggedSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('opacity-40')
    expect(card(container)).toHaveClass('border-dashed')
  })

  it('keeps the empty-room dashed cue visible under an active drop target', () => {
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue={hue} canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('border-primary')
    expect(card(container)).toHaveClass('border-dashed')
  })

  it('drops the empty-room background wash under an active drop target, so the two never race', () => {
    // `.bg-muted/25` (the dashed wash) and `.bg-primary/5` (the drop-target
    // wash) both set `background-color` — a `toHaveClass('border-dashed')`
    // check alone (the test above) cannot see this, because jsdom parses no
    // Tailwind and a class string proves nothing about which declaration a
    // real browser's cascade would pick. This is the same pairing the file's
    // own top-of-diff comment names as the SECOND byte-offset race this
    // refactor exists to kill (the first being `.border-amber-400` vs
    // `.border-primary`) — this is the case of it that mattered for a real,
    // high-frequency gesture: hovering a family drag over an empty room.
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue={hue} canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('bg-primary/5')
    expect(card(container)).not.toHaveClass('bg-muted/25')
  })
})

/*
 * CLAUDE.md §4, "Family Camp Models Summer": *same Tailwind grammar and
 * tokens*, not a parallel one. Summer's `BunkCard` is `text-lg` title,
 * `text-sm` body, `text-xs` meta — three steps of the stock scale. This card
 * was built on `text-[13px]` / `text-[11px]` / `text-[10px]`, an arbitrary
 * scale whose LARGEST size is smaller than summer's BODY.
 *
 * Pinned as classes rather than computed style throughout: jsdom parses no
 * Tailwind, so `toHaveStyle({ fontSize: … })` on a Tailwind class passes
 * against an empty string and proves nothing.
 */
describe('LodgingUnitCard — summer’s type scale', () => {
  /**
   * Every arbitrary-pixel font size anywhere inside the card.
   *
   * The sweep is the load-bearing test and the per-element ones below are its
   * documentation: a single `text-[11px]` left on a nested row is invisible in
   * a spot check and is exactly how the two scales diverged in the first
   * place. `UnitAvailabilityControl` renders INSIDE this card and is swept
   * with it — a 10px pill sitting in a 12px meta row is the same bug.
   */
  function arbitraryTextSizes(container: HTMLElement): string[] {
    const card = container.querySelector('[data-unit-card]')
    if (!card) throw new Error('no card rendered')
    return (
      [card, ...card.querySelectorAll('*')]
        .flatMap((el) => Array.from(el.classList))
        // Variant prefixes and rem/em too, not just a bare `text-[Npx]`: a
        // `sm:text-[11px]` is the same divergence wearing a breakpoint, and the
        // narrower pattern is what let the merge and split pills through once
        // already. Arbitrary COLOURS stay out of scope — `[^\]]+` would sweep
        // `text-[#fff]`, which is not a scale problem.
        .filter((cls) => /^(?:[\w-]+:)*text-\[\d+(?:\.\d+)?(?:px|rem|em)\]$/.test(cls))
    )
  }

  it('uses the stock scale everywhere, with no arbitrary pixel sizes left', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          // `parent_code` + container + combined are what MOUNT the merge and
          // split pills; without them this sweep silently checked a card that
          // had neither, and both kept a `text-[10px]` through the whole
          // type-scale migration. The assertions below are the guard: a sweep
          // that stops rendering an element must fail, not quietly narrow.
          unit: unit({
            is_active: false,
            bathroom: 'private',
            has_power: true,
            has_ac: true,
            parent_code: 'cedar-house',
            is_container: true,
            is_combined: true,
          }),
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
          consent: {
            declinedCount: 1,
            unansweredCount: 0,
            conflictCount: 0,
            reason: 'One household declined sharing',
          },
        })}
        hue="hsl(160 45% 42%)"
        canSetAvailability
        onSetAvailability={vi.fn()}
        canMerge
        onMerge={vi.fn()}
        onSplit={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Merge Cedar 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Split Cedar 1/ })).toBeInTheDocument()
    expect(arbitraryTextSizes(container)).toEqual([])
  })

  it('leaves no arbitrary pixel sizes on an empty slot either', () => {
    // The empty state is its own branch and carried its own `text-[11px]`.
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    expect(arbitraryTextSizes(container)).toEqual([])
  })

  it('titles the unit at summer’s text-lg', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toHaveClass('text-lg')
  })

  it('titles the unit in a heading, which is what carries the display face', () => {
    /*
     * Not cosmetic and not merely semantic. `index.css` sets
     * `h1, h2, h3 { font-family: var(--font-display) }` — Fraunces, with
     * `-0.02em` tracking and `ss01`/`ss02` on. Summer's `BunkCard` titles its
     * bunk in an `<h3>` and gets that face; this card used a `<span>` and got
     * the body sans instead. Same 18px, different typeface, which is why the
     * two boards still did not look alike after the sizes matched.
     *
     * Pinned as a ROLE rather than a tag name: the font comes from the element
     * being a heading, so that is the thing that must not regress.
     */
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Cedar 1', level: 3 })).toBeInTheDocument()
  })

  it('sets the capacity figure at summer’s body size', () => {
    // Summer prints `{occupancy}/{capacity}` at `text-sm`. The figure is the
    // second thing read on the card; at 11px it read as a footnote.
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    // Matched loosely: the title gained the occupancy count alongside the
    // capacity. What this test pins is the SIZE of that element, not its
    // wording — the wording has its own tests.
    expect(screen.getByTitle(/Sleeps 5/)).toHaveClass('text-sm')
  })

  it('sets the consent line at body size, not meta size', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
          consent: {
            declinedCount: 1,
            unansweredCount: 0,
            conflictCount: 0,
            reason: 'One household declined sharing',
          },
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('One household declined sharing')).toHaveClass('text-sm')
  })

  it('sets the empty state at body size', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Empty')).toHaveClass('text-sm')
  })

  it('sets badges and the shared-slot chip at summer’s meta size', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ is_active: false }),
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Inactive')).toHaveClass('text-xs')
    expect(screen.getByText('2 families')).toHaveClass('text-xs')
  })
})

describe('LodgingUnitCard — how full the room is', () => {
  /*
   * The corner figure was CAPACITY, so the card looked identical whether the
   * room was empty or full — the one functional gap the styling work left.
   *
   * Summer prints `{occupancy}/{capacity}` and backs it with a four-stop
   * colour ramp and a utilization bar. NEITHER is ported, deliberately.
   * Summer's ramp is a percentage of a fixed capacity of 12 and has five
   * distinguishable states; family rooms average about five beds and plenty
   * sleep two, where the ramp is a binary wearing four colours. The card's
   * border already carries the area hue (§3.10) and the amber consent edge,
   * so a third channel would be competing for one surface. What is kept is
   * the figure and ONE emphasis state, for the only actionable case.
   */
  it('says how many are in the room, not just what it sleeps', () => {
    render(
      <LodgingUnitCard
        slot={slot({ parties: [party({ party_size: 3 })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  it('distinguishes an empty room from a full one', () => {
    // The whole point: before this, both rendered "5".
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('0/5')).toBeInTheDocument()
  })

  it('marks a room holding more people than it sleeps', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 4 }), parties: [party({ party_size: 6 })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('6/4')).toHaveClass('text-destructive')
    expect(screen.getByText('Over capacity')).toBeInTheDocument()
  })

  it('leaves a room within capacity unmarked', () => {
    render(
      <LodgingUnitCard
        slot={slot({ parties: [party({ party_size: 5 })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('5/5')).not.toHaveClass('text-destructive')
    expect(screen.queryByText('Over capacity')).not.toBeInTheDocument()
  })

  it('never calls an unmeasured room over capacity', () => {
    // No denominator, so there is nothing to be over. Judging it would be the
    // same lie as printing its capacity as 0.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: null }), parties: [party({ party_size: 9 })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('9/—')).toBeInTheDocument()
    expect(screen.queryByText('Over capacity')).not.toBeInTheDocument()
  })

  it('withholds the verdict when a household also holds a room off this card', () => {
    /*
     * The building is drawn SPLIT and one household holds both rooms, so it is
     * drawn on each (#2010, which #2040 left alone). Six people against this
     * room's three beds is not something anyone can support: there is no
     * per-room breakdown to divide by. The figure stands as an upper bound and
     * the CLAIM is withheld — a family spread across two rooms it needs is not
     * over anything.
     */
    const house = unit({ code: 'house', name: 'Aspen House', is_container: true, sleeps: 7 })
    const r1 = unit({ code: 'r1', unit_id: 'u2', name: 'Aspen 1', parent_code: 'house', sleeps: 3 })
    const r2 = unit({ code: 'r2', unit_id: 'u3', name: 'Aspen 2', parent_code: 'house', sleeps: 3 })
    render(
      <LodgingUnitCard
        slot={slot({
          unit: r1,
          parties: [party({ party_size: 6, unit_code: '', unit_codes: ['r1', 'r2'] })],
        })}
        units={[house, r1, r2]}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('6/3')).not.toHaveClass('text-destructive')
    expect(screen.queryByText('Over capacity')).not.toBeInTheDocument()
  })

  it('says the household spans rooms, so the figure is not read as a fault', () => {
    // Without this the bare `6/3` reads as overfull whether or not it is
    // coloured, which is worse than showing nothing.
    const house = unit({ code: 'house', name: 'Aspen House', is_container: true, sleeps: 7 })
    const r1 = unit({ code: 'r1', unit_id: 'u2', name: 'Aspen 1', parent_code: 'house', sleeps: 3 })
    const r2 = unit({ code: 'r2', unit_id: 'u3', name: 'Aspen 2', parent_code: 'house', sleeps: 3 })
    render(
      <LodgingUnitCard
        slot={slot({
          unit: r1,
          parties: [party({ party_size: 6, unit_code: '', unit_codes: ['r1', 'r2'] })],
        })}
        units={[house, r1, r2]}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Spans 2 rooms')).toBeInTheDocument()
  })

  it('says nothing about spanning on an ordinary room', () => {
    render(
      <LodgingUnitCard
        slot={slot({ parties: [party()] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText(/Spans/)).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the occupant well', () => {
  /*
   * Summer's `BunkCard` holds its campers in a `min-h-[100px]` well. This card
   * had no well at all: the empty state was a 4px-padded line, so an empty
   * room was 139px against an occupied median of 188px and a two-party card of
   * up to 357px.
   *
   * The well is what makes dropping `items-start` survivable. Grid row height
   * already equals the tallest card in the row, so stretching does not reclaim
   * a pixel — it moves the whitespace inside the card border. Without a well
   * that grows and an invitation that centres in it, stretch just produces 28
   * blown-up empty boxes with the message pinned to the top edge.
   */
  function well(container: HTMLElement): HTMLElement | null {
    const card = container.querySelector('[data-unit-card]')
    const occupant = card?.querySelector('[data-family-card]')
    if (occupant) return occupant.parentElement
    // Empty slot: the invitation is the well's only child.
    return card?.querySelector('p.italic')?.parentElement ?? null
  }

  it('gives an empty slot a well that grows with the row', () => {
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    expect(well(container)).toHaveClass('min-h-[100px]')
    expect(well(container)).toHaveClass('flex-1')
  })

  it('gives an occupied slot the same well, so rows agree', () => {
    // Same element in both branches on purpose. Two wells drift.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: [party()] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(well(container)).toHaveClass('min-h-[100px]')
    expect(well(container)).toHaveClass('flex-1')
  })

  it('centres the invitation in the well rather than pinning it to the top', () => {
    /*
     * A deliberate divergence, stated because §4 requires it. Summer
     * top-aligns its message under `py-8`, which reads fine because a bunk
     * card is uniformly tall. These cards stretch across a 139–357px range, so
     * a top-aligned message in a tall empty card sits 130px above its own
     * floor. `m-auto` on the sole child of a flex column centres it both ways.
     */
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" canPlace onOpenParty={vi.fn()} />
    )
    const invitation = screen.getByText('Drop families here')
    expect(invitation).toHaveClass('m-auto')
    expect(invitation).not.toHaveClass('py-1')
    expect(container.querySelector('[data-unit-card]')).toBeInTheDocument()
  })
})

describe('LodgingUnitCard — summer’s chrome, the rest of it', () => {
  it('does not copy BunkCard’s inert hover class', () => {
    /*
     * `BunkCard` carries `hover:shadow-lodge-lg`, and trueing this card up
     * against it means copying that — except the class does nothing.
     * `.shadow-lodge-*` are hand-written rules inside `@layer utilities`, not
     * Tailwind `@utility` declarations, so v4 generates no `hover:` variant
     * for them; a browser sweep of all 3,373 loaded rules found no selector
     * matching `hover.*shadow-lodge`. The hover lift both cards actually get
     * comes from `.card-lodge:hover`, whose shadow (`0 12px 32px`) is the
     * deeper of the two anyway.
     *
     * Pinned as an ABSENCE because the next person to read the two class
     * strings side by side will see the gap and close it, exactly as this
     * session nearly did. A dead class spreading by imitation is the
     * `forest-950` failure CLAUDE.md §4 cites (#1894).
     */
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    expect(container.querySelector('[data-unit-card]')).not.toHaveClass('hover:shadow-lodge-lg')
    // The chrome that DOES carry the hover, so this test fails loudly if the
    // card ever stops being a `.card-lodge` rather than silently passing.
    expect(container.querySelector('[data-unit-card]')).toHaveClass('card-lodge')
  })

  it('spaces its rows on summer’s 12px rhythm', () => {
    // Summer separates header / bar / roster with `mb-3` (12px) and the
    // campers inside with `space-y-2` (8px). This card ran everything at a
    // flat 8px, so the title did not separate from the amenity row.
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveClass('gap-3')
    expect(card).not.toHaveClass('gap-2')
  })

  it('spaces two parties on summer’s 8px roster rhythm', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    const roster = container.querySelector('[data-family-card]')?.parentElement
    expect(roster).toHaveClass('gap-2')
    expect(roster).not.toHaveClass('gap-1.5')
  })
})

describe('LodgingUnitCard shareability (kindred#2026)', () => {
  it('marks a unit a second family may be placed into', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'shareable' }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Shared OK')).toBeInTheDocument()
  })

  it('says nothing on a one-family room', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
  })

  it('marks a WHOLE-HOUSE let, which is the card the ruling is actually about', () => {
    // A split container gets no card at all — `dragPlacement` rejects it as a
    // drop target and `unitLevel` fans down past it — so the only container
    // that reaches this component is a COMBINED one, and that is the slot
    // staff place into. The owner's ruling is that two households on one
    // container is a legitimate share, so this is the card that most needs to
    // say so. An earlier version suppressed the chip on every container and
    // hid it in exactly the place it earns its keep.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ is_container: true, is_combined: true, shareability: 'shareable' }),
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Shared OK')).toBeInTheDocument()
  })

  it('flags a unit nobody has classified rather than letting it read as safe', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'unknown' }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Sharing unset')).toBeInTheDocument()
  })
})
