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
    return [card, ...card.querySelectorAll('*')]
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => /^text-\[\d+px\]$/.test(cls))
  }

  it('uses the stock scale everywhere, with no arbitrary pixel sizes left', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ is_active: false, bathroom: 'private', has_power: true, has_ac: true }),
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
        onOpenParty={vi.fn()}
      />
    )
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
    expect(screen.getByTitle('Sleeps 5')).toHaveClass('text-sm')
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
