/**
 * A slot card. One unit, holding nothing, one party, or occasionally two.
 *
 * Not a summer bunk column: a bunk column is tall because it holds 10–14
 * campers. 82 rooms cannot be 82 columns.
 *
 * Fictional data throughout.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow, WriteInCoverRow } from '../../types/lodging'
import type { BoardSlot } from './boardLayout'
import { mergeDragId, unitDroppableId } from './dragPlacement'
import { LodgingUnitCard } from './LodgingUnitCard'

/**
 * jsdom cannot perform a pointer drag, so `useDroppable`'s real `isOver`
 * never goes true here. The settled idiom (`LodgingBoard.drag.test.tsx`) is
 * to mock at the `@dnd-kit/core` boundary; this one only needs `isOver`
 * itself, controlled by `overDroppableId`, to prove the drop-target state
 * outranks the consent ring below. `useDraggable` stays real — the
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

/**
 * The server-resolved write-in cover — the ONLY way the wire says "somebody is
 * in this space" since kindred#2382 PR 4 retired the
 * `family_available_override === false` shim. That field answers the
 * staff↔family ROLE alone now.
 */
function cover(overrides: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    occupant_name: 'Emma Johnson',
    note: '',
    ...overrides,
  }
}

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
    // The RESOLVED field the title row reads since kindred#2072's T2, kept in
    // step with the raw flag beside it because a real server row carries both.
    // `has_power: true` alone no longer draws a plug: twelve of the fourteen
    // 2026 family-pool containers record `has_power = 0` while every leaf
    // beneath them has power, and T2 would have promoted that wrong answer to
    // the most prominent row on the card.
    power_coverage: 'none',
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    // TRUE, and it was `false` until kindred#2072. Production has been 118 of
    // 118 confirmed since 2026-08-09, so an unconfirmed default described no
    // real cabin — and it now decides whether the card draws a meta row at
    // all, since `Reconfirm space` is gated on exactly this field (ruling 23).
    // The unconfirmed branch is the exception, and the tests that want it say
    // so.
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'single_party',
    family_available_override: null,
    occupant_name: '',
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
    const occupancy = screen.getByTestId('unit-occupancy')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sleeps 5/)
  })

  it('puts the capacity sentence on a tooltip keyboard and touch can reach', () => {
    // kindred#2177. The occupancy figure is the smallest trigger on the board,
    // so the primitive's transparent 24px hit target does the tap-target work
    // — NOT a drawn box, which would collide with the dashed empty-room edge.
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    const occupancy = screen.getByTestId('unit-occupancy')
    expect(occupancy.tagName).toBe('BUTTON')
    expect(occupancy).not.toHaveAttribute('title')
    expect(occupancy.className).toContain('after:h-[max(100%,24px)]')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sleeps 5/)
  })

  describe('the infant bed exemption clause (kindred#2212 stage 1)', () => {
    // The card's own `occupants` figure is a BED count (`slotOccupancy` sums
    // `partySize`, which reads the server-reported `party_size`); the reader
    // never sees the NAMED headcount anywhere on this card. When they
    // disagree, a bed was exempted for an infant under 18 months
    // (`INFANT_BED_EXEMPT_MONTHS`, `api/constants/lodging.py`) and the
    // tooltip should say so, rather than silently showing the smaller number.
    //
    // ⚠️ Deliberately built from `party_size` vs. named adults/children --
    // NEVER from `PartyChild.age`, which is CampMinder `yy.mm` and carries a
    // `0.0` unknown-age sentinel (kindred#2212). Thresholding age here would
    // silently sweep that sentinel in as a false "infant".

    it('names the exemption when a party carries more people than recorded beds', () => {
      render(
        <LodgingUnitCard
          slot={slot({
            parties: [
              party({
                adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
                children: [
                  { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
                  { person_cm_id: 9002, display_name: 'Ivy Johnson', age: 0.11, grade: 0 },
                ],
                // Headcount is 1 adult + 2 children = 3; the server reports
                // only 2 beds, discounting the infant.
                party_size: 2,
              }),
            ],
          })}
          hue="hsl(160 45% 42%)"
          onOpenParty={vi.fn()}
        />
      )
      const occupancy = screen.getByTestId('unit-occupancy')
      fireEvent.focus(occupancy)
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Sleeps 5 · 2 placed · an infant is exempt from the bed count'
      )
    })

    it('says nothing extra, and leaves the existing sentence untouched, when headcount matches recorded beds', () => {
      render(
        <LodgingUnitCard
          slot={slot({
            parties: [
              party({
                adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
                children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
                // Headcount is 1 adult + 1 child = 2, matching the 2 beds
                // recorded. No infant was exempted; nothing to explain.
                party_size: 2,
              }),
            ],
          })}
          hue="hsl(160 45% 42%)"
          onOpenParty={vi.fn()}
        />
      )
      const occupancy = screen.getByTestId('unit-occupancy')
      fireEvent.focus(occupancy)
      // Pinned exact, not a substring match: a future edit that silently
      // reworded the ordinary sentence must fail this test.
      expect(screen.getByRole('tooltip')).toHaveTextContent('Sleeps 5 · 2 placed')
      expect(screen.queryByText(/exempt/)).not.toBeInTheDocument()
    })

    it('does not mistake the 0.0 unknown-age sentinel for an infant (the 24-vs-25 case)', () => {
      // kindred#2212: one child in the real 2026 cohort carries `age: 0.0`,
      // CampMinder's UNKNOWN-AGE sentinel, not a newborn's age. The server
      // never discounts that child's bed on the strength of the sentinel, so
      // headcount and recorded beds AGREE for this household and the
      // exemption clause must not fire -- this is exactly why the measured
      // population is 24 affected households, not 25.
      render(
        <LodgingUnitCard
          slot={slot({
            parties: [
              party({
                adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
                children: [
                  { person_cm_id: 9003, display_name: 'Unnamed camper', age: 0.0, grade: 0 },
                ],
                // Headcount is 1 adult + 1 child = 2, matching the 2 beds
                // recorded -- the sentinel child keeps its bed.
                party_size: 2,
              }),
            ],
          })}
          hue="hsl(160 45% 42%)"
          onOpenParty={vi.fn()}
        />
      )
      const occupancy = screen.getByTestId('unit-occupancy')
      fireEvent.focus(occupancy)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Sleeps 5 · 2 placed')
      expect(screen.queryByText(/exempt/)).not.toBeInTheDocument()
    })

    it('pluralizes the clause when more than one infant is exempted in a shared slot', () => {
      render(
        <LodgingUnitCard
          slot={slot({
            parties: [
              party({
                household_cm_id: 101,
                display_name: 'Johnson',
                adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
                children: [
                  { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
                  { person_cm_id: 9002, display_name: 'Ivy Johnson', age: 0.11, grade: 0 },
                ],
                party_size: 2,
              }),
              party({
                household_cm_id: 102,
                display_name: 'Garcia',
                adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
                children: [
                  { person_cm_id: 9004, display_name: 'Mia Garcia', age: 5, grade: 0 },
                  { person_cm_id: 9005, display_name: 'Leo Garcia', age: 0.3, grade: 0 },
                ],
                party_size: 2,
              }),
            ],
          })}
          hue="hsl(160 45% 42%)"
          onOpenParty={vi.fn()}
        />
      )
      const occupancy = screen.getByTestId('unit-occupancy')
      fireEvent.focus(occupancy)
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Sleeps 5 · 4 placed · 2 infants are exempt from the bed count'
      )
    })
  })

  it('describes the unit NAME without turning it into a tooltip trigger', () => {
    // The occupancy `<span>` carried the tooltip, never the `<h3>` beside it.
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1').tagName).toBe('H3')
  })

  /*
   * ⚠️ TWO TESTS WERE HERE AND THE ELEMENT THEY ASSERTED IS STRUCK —
   * `Drop families here` while placement was live, `Empty` otherwise
   * (kindred#2072, vocabulary §3). At 81% of live cards empty it was the
   * most-repeated sentence on the board, and the dashed border plus an empty
   * well already say it.
   *
   * The `canPlace` CONDITIONALITY they protected went with the sentence: there
   * is no wording left to be conditional. The absence is pinned in "the marks
   * kindred#2072 STRUCK from the unit card", along with the dashed border that
   * now carries the state alone.
   */

  it('says two parties are sharing by DRAWING two of them', () => {
    // The `2 families` chip is struck (kindred#2072, vocabulary §3): it
    // counted what the well below already shows by drawing that many cards,
    // and it fired on every shared card including the ones built to be
    // shared. What survives is the well itself, and — where a household
    // declined — the consent sentence, which states a fact rather than a
    // count.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })] })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(container.querySelectorAll('[data-family-card]')).toHaveLength(2)
    expect(screen.queryByText('2 families')).not.toBeInTheDocument()
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

  it('keeps an empty unit dashed and forest-tinted (#2093)', () => {
    // Owner ruling 2026-08-09: HIGHLIGHT an open space with a low-saturation
    // forest tint. The grey `bg-muted/25` wash this used to carry read as
    // "deactivated" and is retired in favour of `bg-primary/10` — `--primary`
    // IS the board's forest hue (index.css), just at resting-state strength
    // rather than the drop target's `bg-primary/5` accent.
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveClass('bg-primary/10')
    expect(card).not.toHaveClass('bg-muted/25')
    expect(card).toHaveClass('border-dashed')
  })

  it('draws a staff room rather than hiding it, and no longer badges it', () => {
    // Staff reason about adjacency; hiding a held room makes the site look
    // smaller than it is — THAT half is unchanged and is what this test now
    // protects. The `Staff` badge itself is struck (kindred#2072): all 25
    // staff units fail `isPlanningInventory`, so no staff card is ever drawn
    // on this board and the badge could not appear. It survives on the map and
    // the units admin table, where such a card does exist.
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
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
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

describe('LodgingUnitCard — a held unit refuses the drop outright (#2087)', () => {
  // The `disabled` half of the fix. `resolveDrop` (dragPlacement.test.ts) is
  // the load-bearing check — #2080's picker never touches a droppable at
  // all — but `useDroppable`'s own `disabled` flag is what keeps dnd-kit
  // from ever reporting `isOver` for a held card in the first place, which
  // is what this asserts.
  function card(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[data-unit-card]')
    if (!el) throw new Error('no card rendered')
    return el as HTMLElement
  }

  const held = unit({ write_ins: [cover()], is_family_available: false })

  it('lights a WRITTEN-INTO unit as a drop target — a write-in does not close the space', () => {
    /*
     * Inverted by kindred#2432's ruling. The droppable was disabled on a
     * written-into unit, the affordance half of #2090's refusal, so a family
     * dragged toward a cabin holding one paper registration never even
     * highlighted. `resolveDrop` no longer refuses that drop, so the
     * affordance must not either — a target that refuses silently is worse
     * than one that never lit.
     */
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: held })}
        hue="hsl(160 45% 42%)"
        canPlace
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-primary')
  })

  it('keeps an ordinary unheld unit droppable enabled (regression guard)', () => {
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('border-primary')
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

describe('LodgingUnitCard — the whole-building mark is STRUCK from the card (kindred#2072)', () => {
  /*
   * §3 of `weekend-card-vocabulary.md`, "Earlier cuts, still struck" — the
   * `Whole building` chip was ruled out and had never been landed.
   *
   * The three cases below are UNCHANGED fixtures with inverted expectations,
   * which is the point: what was tested here was `wholeBuildingHolders`'s
   * containment rule, and that rule is untouched and still exercised by
   * `boardLayout.test.ts` and by the MAP, which keeps the chip
   * (`MapUnitPopover`). Deleting these would have deleted the only pin
   * standing between a future session and helpfully restoring the chip.
   *
   * Kept as a full describe rather than one assertion because the chip could
   * come back through any of the three doors: a whole-house let, a single
   * room, or two households splitting a combined card.
   */
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

  it('draws no chip for a party whose own unit_codes cover the whole card', () => {
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
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })

  it('draws none for a party holding only one room of a two-room half either', () => {
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

  it('draws none for two households splitting a combined card between disjoint rooms', () => {
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

/**
 * The shared-space ring (#2091) is STRUCK — owner ruling 2026-08-09 on #2179.
 *
 * It fired on the units DESIGNED to hold several families, so it was on almost
 * all the time, and a constant is not a signal. There is no replacement mark:
 * not a subtler ring, not a different colour, not a smaller dot. What survives
 * of this block is the precedence it used to sit inside, which now has three
 * tiers instead of four and must still resolve in the same order.
 */
describe('LodgingUnitCard — no shared-space ring (#2179)', () => {
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

  it('draws no ring at all on a card holding two families', () => {
    // The mark that used to live here. The card now says "two families" in
    // the chip below and in nothing else.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: sharedParties })} hue={hue} onOpenParty={vi.fn()} />
    )
    expect(card(container).style.boxShadow).toBe('')
  })

  it('paints no inline box-shadow at ANY occupancy', () => {
    // The whole channel is gone, not merely its two-party branch — with no
    // inline `boxShadow` competing for the property, `.card-lodge`'s own
    // elevation AND its hover lift (`index.css`) come back for free, which
    // the composed ring could never hand back.
    for (const parties of [[], [party()], sharedParties]) {
      const { container, unmount } = render(
        <LodgingUnitCard slot={slot({ parties })} hue={hue} onOpenParty={vi.fn()} />
      )
      expect(card(container).style.boxShadow).toBe('')
      unmount()
    }
  })

  it('keeps the area hue on the top edge — that is not a ring', () => {
    // Explicitly NOT struck. `borderTopColor` is §3.10's secondary channel,
    // and the deletion above must not take it with it.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: sharedParties })} hue={hue} onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveStyle({ borderTopColor: hue })
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

  it('still rings a two-family card amber when the sharing was never consented to', () => {
    // The tier that SURVIVES the deletion, and the one that was always doing
    // the real work: striking `shared` loses nothing because every case worth
    // an alarm was already caught here.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties, consent: declinedConsent })}
        hue={hue}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('border-amber-400')
  })

  it('still gives an active drop target its own ring on an occupied card', () => {
    // Removing a tier from an ordered table is exactly where the remaining
    // tiers silently reindex, so each one is re-pinned rather than assumed.
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
  })

  it('still dims an invalid merge target holding two families', () => {
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
  })

  it('leaves a plain occupied card with no ring class at all', () => {
    // The bottom tier. `plain` has to stay reachable after the table shrinks.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: [party()] })} hue={hue} onOpenParty={vi.fn()} />
    )
    expect(card(container)).not.toHaveClass('border-amber-400')
    expect(card(container)).not.toHaveClass('border-primary')
    expect(card(container)).not.toHaveClass('ring-2')
    expect(card(container).style.boxShadow).toBe('')
  })

  it('lets an active drop target outrank a CONSENT-flagged room too', () => {
    // The "still gives an active drop target its own ring" test above only
    // ever combines an active drop target with `sharedParties` (no `consent`).
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
    // `.bg-primary/10` (the open-space tint, #2093) and `.bg-primary/5` (the
    // drop-target wash) both set `background-color` — a
    // `toHaveClass('border-dashed')` check alone (the test above) cannot see
    // this, because jsdom parses no Tailwind and a class string proves
    // nothing about which declaration a real browser's cascade would pick.
    // This is the same pairing the file's own top-of-diff comment names as
    // the SECOND byte-offset race this refactor exists to kill (the first
    // being `.border-amber-400` vs `.border-primary`) — this is the case of
    // it that mattered for a real, high-frequency gesture: hovering a family
    // drag over an empty room.
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue={hue} canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('bg-primary/5')
    expect(card(container)).not.toHaveClass('bg-primary/10')
    expect(card(container)).not.toHaveClass('bg-muted/25')
  })
})

/**
 * kindred#2179's own warning, which the ring's deletion does NOT strike.
 *
 * A chip in the badge row, on a fourth channel of its own. The vocabulary
 * ruled 2026-08-09 spends `opacity-40` on REFUSAL, `background-image` on the
 * advisory needs misfit and the forest tint on open-and-available; this is a
 * warning about a placement that already happened, so it takes none of them.
 */
/*
 * ⚠️ THE ONE-FAMILY CONFLICT CHIP IS STRUCK — kindred#2072, vocabulary §3.
 *
 * A whole describe block went with it, and that is worth stating rather than
 * leaving as a silent deletion. `One-family space` warned when a second party
 * landed in a unit classified `single_party`; it NEVER FIRED, because all 23
 * room-sharing cards in the registry are classified `shareable`, and staff
 * know which spaces hold one family.
 *
 * `sharingConflictBadge` itself is deleted too — unlike `availabilityAction`,
 * which survives its cut because a write path still stands behind it, this
 * function was presentation logic for one chip and nothing else called it.
 *
 * The absence is pinned in "the marks kindred#2072 STRUCK from the unit card".
 * What the deleted tests protected that is NOT about this chip — that a
 * warning must never dim, refuse a drop, or draw a ring — is a property of
 * `ringPrecedence` and is pinned in "no shared-space ring (#2179)".
 */

describe('LodgingUnitCard — the open-space title marker (#2093)', () => {
  // Owner ruling 2026-08-09: the master housing sheet marks an open space
  // with a yellow fill on its title, and the request was to HIGHLIGHT, never
  // dim, the to-do list. `RING_CLASSES` stays untouched — `color`/`font-weight`
  // on the child `<h3>` doesn't compete with `border-color`/`box-shadow`, so
  // this is additive exactly like `dashed` itself. Gated on `openMarkerActive`
  // rather than bare `dashed` for the same reason the background wash is: the
  // forest tint is a RESTING-STATE signal only, suppressed the instant this
  // card becomes an active drop target — and never spent on a held room,
  // which is empty but not open.
  const hue = 'hsl(160 45% 42%)'

  it('spends the forest tint on an open unit title — colour AND weight, not dimmed', () => {
    render(<LodgingUnitCard slot={slot()} hue={hue} onOpenParty={vi.fn()} />)
    const title = screen.getByText('Cedar 1')
    expect(title).toHaveClass('text-primary')
    expect(title).toHaveClass('font-bold')
    expect(title).not.toHaveClass('text-foreground')
    expect(title).not.toHaveClass('font-semibold')
    expect(title).not.toHaveClass('text-muted-foreground')
    expect(title).not.toHaveClass('opacity-40')
  })

  it('leaves an occupied unit title in the plain foreground weight', () => {
    render(<LodgingUnitCard slot={slot({ parties: [party()] })} hue={hue} onOpenParty={vi.fn()} />)
    const title = screen.getByText('Cedar 1')
    expect(title).toHaveClass('text-foreground')
    expect(title).toHaveClass('font-semibold')
    expect(title).not.toHaveClass('text-primary')
    expect(title).not.toHaveClass('font-bold')
  })

  it('suppresses the open-space title emphasis while this card is an active drop target', () => {
    // Mid-drag the board is answering a different question — this is the
    // title-side half of the same suppression the background wash already
    // gets, sharing the identical `openMarkerActive` gate rather than a
    // second, independently-derived condition that could drift from it.
    overDroppableId = unitDroppableId('cedar-1')
    render(<LodgingUnitCard slot={slot()} hue={hue} canPlace onOpenParty={vi.fn()} />)
    const title = screen.getByText('Cedar 1')
    expect(title).not.toHaveClass('text-primary')
    expect(title).not.toHaveClass('font-bold')
    expect(title).toHaveClass('text-foreground')
    expect(title).toHaveClass('font-semibold')
  })

  it('does not call a WRITTEN-INTO room open — no tint, no bold title, dashed edge kept', () => {
    /*
     * A write-in (#2078; #2087 / the #2090 ruling) blocks placement outright:
     * `dragPlacement.ts:222` refuses the drop and the card's own droppable is
     * `disabled`. An empty held cabin therefore has no family in it and can
     * take none — "empty" and "open" are not the same predicate, and this is
     * the one place they part.
     *
     * This was harmless while the empty treatment was a neutral grey wash.
     * The forest tint is not neutral: it says "this is where the remaining
     * work is", and the marker IS the to-do list. Painting a written-into
     * cabin forest sends staff at the one room they are not allowed to fill.
     *
     * kindred#2078 RE-EXPRESSED this conjunct. It used to read the proxy
     * `unit.family_available_override === false` inline under the name `held`;
     * it now goes through `writeInEntries`, so the tint is keyed on the fact
     * ("somebody is in this room") rather than on a spelling. This test is
     * what pins that the re-expression did not drop the gate.
     *
     * Scope note: the approved 2026-08-09 vocabulary gives such a card a
     * refusal treatment of its own (dim + `not-allowed`), queued separately.
     * This asserts only that the OPEN marker stands down — it does not
     * pre-empt that.
     */
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ write_ins: [cover()], occupant_name: 'Emma Johnson' }),
        })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )
    const title = screen.getByText('Cedar 1')
    expect(title).not.toHaveClass('text-primary')
    expect(title).not.toHaveClass('font-bold')
    expect(title).toHaveClass('text-foreground')
    expect(title).toHaveClass('font-semibold')

    const card = container.querySelector('[data-unit-card]')
    expect(card).not.toHaveClass('bg-primary/10')
    // The dashed EDGE is a structural "no family is in here" and stays — only
    // the affirmative "go fill this" half stands down.
    expect(card).toHaveClass('border-dashed')
  })

  it('withholds the tint from a write-in nobody named, too', () => {
    // The room is closed whether or not anybody filled the name in, so the
    // gate cannot be keyed on the NAME being present -- that would hand the
    // one room staff may not fill straight back to the to-do marker. Reachable
    // from a pre-1500000148 row with an empty note, or through the permissive
    // write schema.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ occupant_name: '' })] }) })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(container.querySelector('[data-unit-card]')).not.toHaveClass('bg-primary/10')
  })

  it('still calls a RELEASED staff cabin open', () => {
    // `true` and `false` are opposite answers. A release opens a room to
    // families -- it is exactly the room the marker exists to send staff at --
    // so reading the override for truthiness here would suppress the tint on
    // the one card that most deserves it.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            inventory_class: 'staff_default',
            family_available_override: true,
            reason: 'Overflow weekend',
          }),
        })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(container.querySelector('[data-unit-card]')).toHaveClass('bg-primary/10')
  })
})

describe('the write-in occupant card (kindred#2078)', () => {
  const hue = 'hsl(160 45% 42%)'

  it('draws the occupant in the well, where the board prints occupancy', () => {
    // The name used to be a small italic muted line under the badge row while
    // the well below said "Drop families here" -- the room read as empty and
    // closed when in truth it was full.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            write_ins: [cover()],
            occupant_name: 'Emma Johnson',
            is_family_available: false,
          }),
        })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Drop families here')).not.toBeInTheDocument()
  })

  it('prints the occupant ONCE, not twice', () => {
    // 1500000148 moved every historical note into `occupant_name` and cleared
    // the column behind it precisely so one string cannot render as both the
    // card's italic reason line and the occupant's name.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            write_ins: [cover({ occupant_name: 'Liam Garcia' })],
            occupant_name: 'Liam Garcia',
            is_family_available: false,
          }),
        })}
        hue={hue}
        canSetAvailability
        onSetAvailability={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getAllByText('Liam Garcia')).toHaveLength(1)
  })

  it('does not draw an occupant card on an ordinary open room', () => {
    render(<LodgingUnitCard slot={slot()} hue={hue} canPlace onOpenParty={vi.fn()} />)

    // The empty well draws NOTHING now — not an occupant card, and not the
    // struck invitation sentence either.
    expect(screen.getByTestId('occupant-well')).toBeEmptyDOMElement()
    expect(screen.queryByText('Occupant not named')).not.toBeInTheDocument()
  })

  it('refuses to assert a number it does not have, where 0 would be a lie', () => {
    // A write-in occupies WHOLESALE: no party size, no partial bed arithmetic.
    // `0/5` beside a full room is a lie and `5/5` is a different one, so the
    // numerator takes the em dash the card already uses to refuse an
    // unmeasured denominator.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            write_ins: [cover()],
            occupant_name: 'Emma Johnson',
            is_family_available: false,
          }),
        })}
        hue={hue}
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('—/5')
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
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-sm')
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

  // The empty-state size assertion went with the sentence it measured
  // (kindred#2072). Nothing renders in an empty well now, so there is no size
  // to pin; the absence is pinned in the STRUCK describe instead.

  it('sets the surviving meta marks at summer’s meta size', () => {
    // `2 families` was the other half of this assertion and is struck. What
    // remains of the meta row is `Inactive` and `Reconfirm space`, and the
    // scale rule they have to meet is unchanged.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ is_active: false, is_confirmed: false }),
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Inactive')).toHaveClass('text-xs')
    expect(screen.getByText('Reconfirm space')).toHaveClass('text-xs')
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
    // The RED FIGURE IS THE WHOLE MARK now: the `Over capacity` pill beside
    // it is struck (kindred#2072), because it stated at chip weight exactly
    // what the figure states in colour, on the two cards a weekend that
    // qualify.
    expect(screen.getByText('6/4')).toHaveClass('text-destructive')
    expect(screen.queryByText('Over capacity')).not.toBeInTheDocument()
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

  /*
   * ⚠️ `Spans N rooms` IS STRUCK (kindred#2072, vocabulary §3), and the test
   * that asserted it is gone rather than inverted here — the STRUCK describe
   * carries the negative pin with the same fixture.
   *
   * What it protected is NOT the chip and is untouched: `slotOccupancy`'s
   * `spanWidth` still withholds the over-capacity CLAIM from a party drawn on
   * several cards, which is the half that could produce a wrong red figure.
   * The chip only explained the figure, and dropping somebody into a container
   * is a deliberate act that needs no explaining. Measured at ZERO spanning
   * parties after #2040.
   */

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
    // By its own testid since kindred#2072. It used to be found through its
    // children — the occupant card, or the empty state's italic `<p>` — and
    // the second of those is struck, so an empty well now has no child to find
    // it by at all.
    return container.querySelector('[data-testid="occupant-well"]')
  }

  it('gives an empty slot a well that grows with the row', () => {
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    // B·2: the min-height is struck and `flex-1` is not. They were always two
    // decisions — the floor lifted an empty card toward the occupied median,
    // and `flex-1` is what makes the grid's stretch survivable at all.
    expect(well(container)).not.toHaveClass('min-h-[100px]')
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
    expect(well(container)).not.toHaveClass('min-h-[100px]')
    expect(well(container)).toHaveClass('flex-1')
  })

  /*
   * ⚠️ The `m-auto` centring test went with the sentence it centred
   * (kindred#2072). It recorded a deliberate divergence — summer top-aligns
   * its message under `py-8`, which reads fine on a uniformly tall bunk card
   * and leaves a message 130px above the floor of a 357px empty lodging card.
   * With no message there is nothing to align, and the divergence retires with
   * it rather than being restated about an empty box.
   */

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

  it('spaces its rows TIGHTER than summer, deliberately (B·1)', () => {
    /*
     * ⚠️ THIS ASSERTION IS INVERTED, and the inversion is the ruling.
     *
     * It used to read `gap-3` and NOT `gap-2`, on the reasoning that summer
     * separates header / bar / roster with `mb-3` and that a flat 8px left the
     * title sitting on top of the amenity row. The second half is what
     * changed: T2 lifted the amenities onto the title row, so there is no
     * amenity row left to separate from.
     *
     * The divergence is topology rather than taste, which is the bar
     * CLAUDE.md §4 sets: a summer bunk card holds 10–14 campers, so 12px is a
     * small fraction of a tall card, where a lodging card holds nothing or one
     * party and the same rhythm is most of it. Measured at −148px across the
     * board, 8.3%, and about −15% of column height together with B·2.
     */
    const { container } = render(
      <LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveClass('gap-2')
    expect(card).not.toHaveClass('gap-3')
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

describe('LodgingUnitCard — shareability left the card (kindred#2026 → kindred#2072)', () => {
  /*
   * ⚠️ THREE ASSERTIONS ARE INVERTED HERE, AND ONE SURVIVES UNCHANGED.
   *
   * `Shared OK` is struck from the CARD (vocabulary §3): it granted something,
   * so kindred#2026 made it legible — but it sits on 44 of 118 rows, and the
   * board's own geometry already says which cards take two families, because
   * the well simply draws two. `shareabilityBadge` is untouched and
   * `MapUnitPopover` still draws it, on a surface with no card geometry to
   * imply it.
   *
   * `Sharing unset` is not struck but RE-GATED and renamed: `Reconfirm space`,
   * keyed on `is_confirmed` instead of `shareability` — the old gate was the
   * wrong column, where all 118 rows are classified and none is unset, so the
   * chip could never appear (ruling 23).
   *
   * What survives untouched is the WHOLE-HOUSE case's reasoning: a split
   * container gets no card at all, so the only container reaching this
   * component is a combined one, and two households on it is a legitimate
   * share. That is now expressed by the card accepting them rather than by a
   * chip announcing the permission.
   */
  it('draws no "Shared OK" chip on a shareable room', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'shareable' }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
  })

  it('says nothing on a one-family room either', () => {
    render(<LodgingUnitCard slot={slot()} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
  })

  it('draws no chip on a WHOLE-HOUSE let, and still takes both households', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ is_container: true, is_combined: true, shareability: 'shareable' }),
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
        })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-family-card]')).toHaveLength(2)
  })

  it('no longer flags an unclassified unit — that chip changed columns', () => {
    // `Sharing unset` fired on `shareability`, where 0 of 118 rows are unset.
    // `Reconfirm space` fires on `is_confirmed`, which is the question staff
    // actually have at season start — see the ruling 23 describe.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'unknown', is_confirmed: true }) })}
        hue="hsl(160 45% 42%)"
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
    expect(screen.queryByText('Reconfirm space')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the needs-misfit hatch (#1912)', () => {
  /*
   * The board's signal vocabulary, ruled 2026-08-09 and binding here:
   *
   *   dim (`opacity-40` + `pointer-events-none`) = REFUSAL — an invalid merge
   *     target, or a held space (#2087). "You may not."
   *   hatch (`background-image`, FULL strength) = ADVISORY MISFIT — "it will
   *     work; nothing here meets the need". This block.
   *   forest tint = open and available, at rest (#2093).
   *
   * The hatch must never touch opacity. Counted across the board there were
   * four meanings on the opacity channel before the ruling, three of them
   * able to appear at once mid-drag; a card dimmed for a fit miss reads as a
   * weaker refusal rather than as a different kind of statement.
   */
  const hue = 'hsl(160 45% 42%)'
  /** Enough of the arbitrary property to identify the mark, whatever its period. */
  const HATCH = '[background-image:repeating-linear-gradient'
  const needsPower = party({ flags: { needs_power: true } })

  function card(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[data-unit-card]')
    if (!el) throw new Error('no card rendered')
    return el as HTMLElement
  }

  function hatchClass(container: HTMLElement): string {
    const el = card(container)
    return [...el.classList].find((name) => name.startsWith(HATCH)) ?? ''
  }

  it('marks nothing at rest, however badly the space fits', () => {
    // The mark is a DRAG-STATE mark. At rest there is no family to judge it
    // against, and a permanently hatched board says nothing at all.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toBe('')
    expect(card(container)).not.toHaveAttribute('data-needs-fit')
  })

  it('hatches a space where no room meets the dragged family need', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toContain('repeating-linear-gradient')
    expect(card(container)).toHaveAttribute('data-needs-fit', 'unmet')
  })

  it('grades SOME from NONE by hatch period, never by a second channel', () => {
    const none = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    const some = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'some' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    const tight = hatchClass(none.container)
    const wide = hatchClass(some.container)
    expect(tight).not.toBe('')
    expect(wide).not.toBe('')
    expect(tight).not.toBe(wide)
    // Same ink, different spacing. If the two ever differ in their colour
    // stop, the grade has quietly moved onto a strength channel.
    expect(tight).toContain('hsl(var(--foreground)_/_0.1)')
    expect(wide).toContain('hsl(var(--foreground)_/_0.1)')
    expect(some.container.querySelector('[data-unit-card]')).toHaveAttribute(
      'data-needs-fit',
      'partial'
    )
  })

  it('never dims — the hatch is advisory and a dim is a refusal', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        canPlace
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).not.toBe('')
    expect(card(container)).not.toHaveClass('opacity-40')
    expect(card(container)).not.toHaveClass('pointer-events-none')
    expect([...card(container).classList].filter((n) => n.startsWith('opacity-'))).toEqual([])
  })

  it('leaves a space that meets the need unmarked mid-drag', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'all' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toBe('')
  })

  it('marks nothing for a family that asked for nothing', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        draggingParty={party()}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toBe('')
  })

  it('judges the resolved coverage, never the container row', () => {
    // Twelve of the fourteen 2026 family-pool containers record
    // `has_power = 0` while every leaf beneath them has power.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ has_power: false, power_coverage: 'all' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toBe('')
  })

  it('composes with the open-space forest tint rather than suppressing it', () => {
    // ORTHOGONAL properties: #2093's tint is `background-color`, this is
    // `background-image`. Both paint, at full strength — an empty space that
    // does not meet the need is still an empty space. No suppression logic
    // belongs between them, and adding any would be reaching into #2093's
    // own gate.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        hue={hue}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('bg-primary/10')
    expect(hatchClass(container)).not.toBe('')
  })
})

describe('LodgingUnitCard — placing a family from the space itself (kindred#2080, AS2)', () => {
  /*
   * THE GATES ARE UNCHANGED; ONLY THE CONTROL'S SHAPE MOVED.
   *
   * kindred#2080's ruling put an inline combobox in the card's own badge row —
   * "not a popover and not a second surface" — and every gate below was
   * written against it. AS2 (owner, 2026-08-19) supersedes that ruling FOR
   * THIS CONTROL: an `Assign` pill opens `AssignFamilyModal`, because a
   * candidate row now carries party size against the beds left, the need
   * glyphs coloured against this room, last year's cabin and a fit verdict,
   * and none of that fits in a 244px card.
   *
   * So these tests are RETARGETED rather than rewritten: each one still asks
   * exactly what it asked before — is the control offered, and does the write
   * land — against the control that exists now. The one that changed meaning
   * is called out where it sits.
   */
  const HUE = 'hsl(160 45% 42%)'
  const unplaced = party({
    household_cm_id: 202,
    display_name: 'Garcia',
    sort_name: 'Garcia',
    adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
    children: [],
    unit_code: '',
    unit_name: '',
    unit_codes: [],
  })

  function renderCard(props: Record<string, unknown> = {}) {
    const onPlaceParty = vi.fn()
    const view = render(
      <LodgingUnitCard
        slot={slot()}
        hue={HUE}
        canPlace={true}
        unplacedParties={[unplaced]}
        onPlaceParty={onPlaceParty}
        onOpenParty={vi.fn()}
        {...props}
      />
    )
    return { ...view, onPlaceParty }
  }

  const assignPill = () => screen.getByRole('button', { name: /assign to cedar 1/i })

  it('offers the control on an empty, available space while placement is live', () => {
    renderCard()
    expect(assignPill()).toBeInTheDocument()
  })

  it('does not grow the card at all, and mounts no list until it is opened', () => {
    /*
     * The old ruling's only real cost was that the inline list grew the card,
     * and its answer was to render the list only once the box was engaged.
     * The modal removes the cost outright: the card holds a pill, and the list
     * does not exist anywhere until somebody clicks it.
     *
     * That is also the performance half of AS2, and it is why this assertion
     * is worth more than it looks: ~82 cards each mounted a picker holding the
     * WHOLE unplaced queue, memoising an annotate-and-sort over up to 63
     * parties. One modal replaces all of it.
     *
     * jsdom has no layout engine, so the claim is pinned STRUCTURALLY rather
     * than in pixels.
     */
    renderCard()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.queryByText('Liam Garcia')).not.toBeInTheDocument()
  })

  it('opens the modal on the pill, with the queue in it', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(assignPill())
    expect(screen.getByRole('dialog')).toHaveTextContent('Assign to Cedar 1')
    expect(screen.getByRole('option', { name: /Liam Garcia/ })).toBeInTheDocument()
  })

  it('writes the placement through the board', async () => {
    const user = userEvent.setup()
    const { onPlaceParty } = renderCard()
    await user.click(assignPill())
    await user.click(screen.getByRole('option', { name: /Liam Garcia/ }))
    expect(onPlaceParty).toHaveBeenCalledTimes(1)
    expect(onPlaceParty.mock.calls[0]?.[0]).toMatchObject({ code: 'cedar-1' })
    expect(onPlaceParty.mock.calls[0]?.[1]).toEqual(unplaced)
  })

  it('closes the modal once the placement is written', async () => {
    // The card the staff member was filling is filled. Leaving the dialog open
    // over a board that just changed under it invites a second placement
    // nobody asked for.
    const user = userEvent.setup()
    renderCard()
    await user.click(assignPill())
    await user.click(screen.getByRole('option', { name: /Liam Garcia/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends a write-in, with its note, through the availability write', async () => {
    // The note is NEW: the inline box collected an occupant name and sent
    // `reason: ''` with a comment saying this path did not collect one. The
    // modal has room for it, so the write finally carries what staff typed.
    const user = userEvent.setup()
    const onSetAvailability = vi.fn()
    renderCard({ canSetAvailability: true, onSetAvailability })
    await user.click(assignPill())
    await user.type(screen.getByRole('searchbox'), 'Burst pipe')
    await user.type(screen.getByLabelText(/note/i), 'back Monday')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))
    expect(onSetAvailability).toHaveBeenCalledWith({
      unitId: 'u1',
      unitName: 'Cedar 1',
      familyAvailable: false,
      occupantName: 'Burst pipe',
      reason: 'back Monday',
    })
  })

  it('is PRESENT on a written-into space, so a second occupant can be added either way round', () => {
    /*
     * Inverted by kindred#2432. The control used to vanish here, mirroring
     * the strip's write-in, on #2090's rule that a write-in and a placement
     * were mutually exclusive. They are not: the reported case is one paper
     * registration — which has no CampMinder record, so a write-in is the only
     * way to record it — sharing a cabin with one placed family.
     *
     * Still not DIMMED, which is the half that survives: `opacity-40` means
     * REFUSAL on this board and is spoken for by the invalid merge target.
     */
    const { container } = renderCard({
      slot: slot({ unit: unit({ write_ins: [cover()] }) }),
    })
    expect(assignPill()).toBeInTheDocument()
    expect(container.querySelector('.opacity-40')).toBeNull()
  })

  it('is PRESENT on an occupied space — it is the only write-in path there is', () => {
    // Inverted by the owner ruling of 2026-08-18. It used to be absent here,
    // "mirroring Hold", and that was coherent while the box only placed
    // families: a second family reaches a shareable space by drag. It stopped
    // being coherent when the box became the only way to write somebody in —
    // a partly-filled merged building then offered no input at all, since the
    // strip's write-in was refused by #2090's gate and its rooms lose their
    // cards to the merge.
    renderCard({ slot: slot({ parties: [party()] }) })
    expect(assignPill()).toBeInTheDocument()
  })

  it('is absent without a scenario or without the permission to place', () => {
    renderCard({ canPlace: false })
    expect(screen.queryByRole('button', { name: /assign to cedar 1/i })).not.toBeInTheDocument()
  })

  it('is absent when the board wires no writer', () => {
    // `undefined` is how the board spells "not writable right now" under
    // `exactOptionalPropertyTypes`, matching `onSetAvailability`.
    renderCard({ onPlaceParty: undefined })
    expect(screen.queryByRole('button', { name: /assign to cedar 1/i })).not.toBeInTheDocument()
  })

  it('is absent on a container the tree has not combined', () => {
    // `resolveDrop` refuses one as a target, so offering the control would
    // name an action that writes nothing.
    renderCard({ slot: slot({ unit: unit({ is_container: true, is_combined: false }) }) })
    expect(screen.queryByRole('button', { name: /assign to cedar 1/i })).not.toBeInTheDocument()
  })

  it('mounts no inline combobox anywhere on the card — the picker is STRUCK', () => {
    /*
     * The negative pin for AS2. `PlaceFamilyPicker` is deleted, and the shape
     * it had — a typeahead living in the card's badge row, growing the card in
     * place — is what must not come back: it is the shape the superseded
     * ruling asked for, so it is exactly what a later reader would restore
     * from that ruling without knowing it had moved.
     */
    renderCard({ canSetAvailability: true, onSetAvailability: vi.fn() })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — no sr-only text of any kind (kindred#2348)', () => {
  /*
   * The site kindred#2249's sweep MISSED: kindred#2230 shipped a
   * `role="status" aria-live="polite" className="sr-only"` placement
   * announcement on 2026-08-09, and the DO-NOT-ADD policy landed one day
   * later without removing it. Pinned NEGATIVELY here, the way every other
   * site in this sweep is pinned, so the region cannot come back unnoticed
   * a third time.
   *
   * Asserted on a card holding a party whose headcount exceeds its recorded
   * beds — the exact shape whose occupancy sentence was the Cmd+F hit in the
   * field report — so this also guards the `ui/Tooltip` mirror from
   * reappearing THROUGH this card.
   */
  const infantSlot = slot({
    parties: [
      party({
        adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
        children: [
          { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
          { person_cm_id: 9002, display_name: 'Ivy Johnson', age: 0.11, grade: 0 },
        ],
        party_size: 2,
      }),
    ],
  })

  it('renders no sr-only node and no aria-live region at rest', () => {
    const { container } = render(
      <LodgingUnitCard slot={infantSlot} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />
    )
    expect(container.querySelectorAll('.sr-only')).toHaveLength(0)
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0)
  })

  it('keeps the occupancy sentence OUT of the DOM until the bubble is opened', () => {
    // The measured defect: find-in-page matched `infant` four times on the
    // Housing tab and highlighted nothing, because `ui/Tooltip` mirrored
    // every closed bubble's sentence into an `sr-only` span.
    render(<LodgingUnitCard slot={infantSlot} hue="hsl(160 45% 42%)" onOpenParty={vi.fn()} />)
    expect(screen.queryByText(/exempt from the bed count/)).not.toBeInTheDocument()
    fireEvent.focus(screen.getByTestId('unit-occupancy'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Sleeps 5 · 2 placed · an infant is exempt from the bed count'
    )
  })
})

describe('LodgingUnitCard — the write-in chip, dropped in favour of the well (kindred#2252)', () => {
  const HUE = 'hsl(160 45% 42%)'
  const WRITTEN_IN = unit({
    write_ins: [cover()],
    occupant_name: 'Emma Johnson',
    is_family_available: false,
  })

  it('drops the redundant "Write-in" chip from the badge row — WriteInCard already names the occupant', () => {
    // Before #2252 a written-into card said the same thing twice: a slate
    // "Write-in" chip in the badge row, and the occupant's own name in the
    // `WriteInCard` drawn in the well below. The chip is gone from THIS card;
    // the well is untouched.
    render(<LodgingUnitCard slot={slot({ unit: WRITTEN_IN })} hue={HUE} onOpenParty={vi.fn()} />)

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Write-in')).not.toBeInTheDocument()
  })

  it('draws NO reservation badge of any kind on this card any more', () => {
    /*
     * ⚠️ TWO TESTS COLLAPSED INTO THIS ONE, and the change is bigger than the
     * suppression they guarded.
     *
     * They pinned that #2252's write-in suppression was SCOPED — that
     * `Shared OK` and `Staff` still reached the card through
     * `reservationBadge` / `shareabilityBadge`. kindred#2072 struck every one
     * of those marks from this card (vocabulary §3), so the scoping question
     * has no card-side answer left: the render site is gone, not merely quiet.
     *
     * Both functions are untouched and `MapUnitPopover` still calls them.
     * `writeInBadgeApplies`'s own two halves — the `staff_default` exemption
     * and the `hasWriteIn` read — are pinned directly in `unitBadges.test.ts`
     * now, against `reservationBadge`, where they cannot be lost to a change
     * on this surface again.
     */
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            shareability: 'shareable',
            inventory_class: 'staff_default',
            write_ins: [cover()],
            family_available_override: true,
          }),
        })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    for (const label of ['Shared OK', 'Staff', 'Released', 'Write-in', 'Building']) {
      expect(within(container).queryByText(label)).not.toBeInTheDocument()
    }
  })
})

describe('LodgingUnitCard — T2: the amenities ride the TITLE row', () => {
  /*
   * A VARIABLE BLOCK, never a fixed three-icon slot, and the measurement is
   * the whole reason. An agent shaped all 73 drawn unit names in the exact
   * Fraunces the app loads and cross-validated in headless Chrome: at the
   * 280px column the variable block fits every card with ≥31px to spare,
   * while a fixed slot truncates six — and truncates the WRONG END, because
   * those six are a numbered series whose only distinguishing character is
   * the last one. The board lives in a 280–292px band, so it sits on the
   * cliff rather than past it.
   */
  const HUE = 'hsl(160 45% 42%)'
  const renderUnit = (overrides: Partial<LodgingUnitRow>) =>
    render(
      <LodgingUnitCard slot={slot({ unit: unit(overrides) })} hue={HUE} onOpenParty={vi.fn()} />
    )

  it('draws only what the room actually has', () => {
    const { container } = renderUnit({
      bathroom: 'shared',
      has_power: true,
      power_coverage: 'all',
      has_ac: false,
    })
    const title = container.querySelector('[data-testid="unit-title-row"]')
    expect(title?.querySelector('[data-testid="amenity-bathroom"]')).not.toBeNull()
    expect(title?.querySelector('[data-testid="amenity-power"]')).not.toBeNull()
    expect(title?.querySelector('[data-testid="amenity-ac"]')).toBeNull()
  })

  it('draws nothing at all for a room with no recorded amenities', () => {
    const { container } = renderUnit({ bathroom: 'none', has_power: false, has_ac: false })
    expect(container.querySelectorAll('[data-testid^="amenity-"]')).toHaveLength(0)
  })

  it('keeps the title, the amenities and the occupancy figure on ONE row', () => {
    const { container } = renderUnit({
      bathroom: 'shared',
      has_power: true,
      power_coverage: 'all',
      has_ac: true,
    })
    const title = container.querySelector('[data-testid="unit-title-row"]')
    expect(title?.querySelector('h3')).not.toBeNull()
    expect(title?.querySelector('[data-testid="unit-occupancy"]')).not.toBeNull()
    expect(title?.querySelectorAll('[data-testid^="amenity-"]')).toHaveLength(3)
  })

  it('says the room HAS a bathroom, and never which kind', () => {
    /*
     * Ruling 2, and vocabulary §4 is the argument: the CampMinder question
     * behind the flag asks for "a bathroom that doesn't require you to leave
     * your cabin", which is `bathroom != 'none'`. A shared unit satisfies it
     * as fully as a private one, and of the 6 private units 5 are staff
     * housing no weekend has ever released — so the distinction is one no
     * staff member can act on.
     *
     * The old meta row spelled it out as `Bath Private` / `Bath Shared`.
     */
    const shared = renderUnit({ bathroom: 'shared' })
    expect(screen.getByTestId('amenity-bathroom')).toBeInTheDocument()
    expect(screen.queryByText('Shared')).not.toBeInTheDocument()
    shared.unmount()

    renderUnit({ bathroom: 'private' })
    expect(screen.getByTestId('amenity-bathroom')).toBeInTheDocument()
    expect(screen.queryByText('Private')).not.toBeInTheDocument()
  })

  it('draws no bathroom mark for a room with none, or one nobody recorded', () => {
    const none = renderUnit({ bathroom: 'none' })
    expect(screen.queryByTestId('amenity-bathroom')).not.toBeInTheDocument()
    none.unmount()
    renderUnit({ bathroom: 'unknown' })
    expect(screen.queryByTestId('amenity-bathroom')).not.toBeInTheDocument()
  })

  it('reads POWER off the resolved coverage, not the container’s own blank row', () => {
    /*
     * ⚠️ T2 PROMOTES A MEASURED PRE-EXISTING BUG TO THE MOST PROMINENT ROW ON
     * THE CARD, which is why it is fixed in the same change rather than after
     * it. Twelve of the fourteen 2026 family-pool containers record
     * `has_power = 0` while every leaf beneath them has power. The amenity
     * strip rendered the raw flag, so those twelve drew no plug; moving that
     * to the title row would have made the wrong answer the first thing staff
     * read. `power_coverage` is already on the wire and is what `needsFit` and
     * `needGlyphs` have always used.
     */
    renderUnit({ is_container: true, is_combined: true, has_power: false, power_coverage: 'all' })
    expect(screen.getByTestId('amenity-power')).toBeInTheDocument()
  })

  it('draws the plug for a building where only SOME rooms have power', () => {
    // Presence, like the bathroom: the mark says the building offers it
    // somewhere. WHETHER IT REACHES THIS FAMILY is the need glyph's question,
    // and `needsFit` already grades `some` as a softer misfit on the hatch.
    renderUnit({ is_container: true, is_combined: true, power_coverage: 'some' })
    expect(screen.getByTestId('amenity-power')).toBeInTheDocument()
  })

  it('draws no plug where no room has power', () => {
    renderUnit({ has_power: false, power_coverage: 'none' })
    expect(screen.queryByTestId('amenity-power')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the FOOTER row', () => {
  const HUE = 'hsl(160 45% 42%)'

  it('carries Assign, Merge and Split together, below the well', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ parent_code: 'house', is_container: false }) })}
        hue={HUE}
        canPlace={true}
        unplacedParties={[]}
        onPlaceParty={vi.fn()}
        canMerge={true}
        onMerge={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    const footer = screen.getByTestId('unit-footer')
    expect(within(footer).getByRole('button', { name: /assign to cedar 1/i })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: /merge cedar 1/i })).toBeInTheDocument()
    // Below the occupant well, which is what makes it a footer rather than a
    // second meta row.
    const well = container.querySelector('[data-testid="occupant-well"]')
    expect(well?.compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('holds Split on a combined container', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_container: true, is_combined: true }) })}
        hue={HUE}
        canMerge={true}
        onSplit={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(
      within(screen.getByTestId('unit-footer')).getByRole('button', { name: /split cedar 1/i })
    ).toBeInTheDocument()
  })

  it('is absent entirely when the card offers no control at all', () => {
    // A read-only board. An empty footer would spend a row saying nothing —
    // the same reasoning the meta row now follows.
    render(<LodgingUnitCard slot={slot()} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryByTestId('unit-footer')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the meta row survives ONLY for what needs it (0a)', () => {
  /*
   * Ruling 12 said the meta row is deleted because T2 and the footer move
   * empty it. That premise was FALSE against the tree: the row held ten
   * things, and three of them were in neither the amenities nor the controls.
   * `Building` was ruled cut on 2026-08-19; `Inactive` and `Reconfirm space`
   * were not, so deleting the row literally would have deleted two marks
   * nobody ruled on.
   *
   * Owner ruling: keep a row that renders ONLY when one of the two is
   * present. On today's data that is never — 0 of 118 inactive, 118 of 118
   * confirmed — so every live card gets ruling 12's outcome, and both marks
   * keep a home for when kindred#2500 makes a new season start unconfirmed.
   */
  const HUE = 'hsl(160 45% 42%)'

  it('draws NO meta row on an ordinary card', () => {
    render(<LodgingUnitCard slot={slot()} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryByTestId('unit-meta')).not.toBeInTheDocument()
  })

  it('draws it for a deactivated room somebody is still in', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_active: false }), parties: [party()] })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(screen.getByTestId('unit-meta')).getByText('Inactive')).toBeInTheDocument()
  })

  it('draws it for a cabin nobody has checked this season', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_confirmed: false }) })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(screen.getByTestId('unit-meta')).getByText('Reconfirm space')).toBeInTheDocument()
  })
})

describe('LodgingUnitCard — Reconfirm space is re-gated on is_confirmed (ruling 23)', () => {
  /*
   * ★ THE OLD GATE WAS THE WRONG COLUMN. `Sharing unset` fired on
   * `shareability`, where all 118 registry rows are classified — 44
   * shareable, 74 single_party, 0 unset — so it could never appear. Keyed on
   * `is_confirmed` it becomes the mark staff actually want, and it goes live
   * the moment kindred#2500 makes a new year start unconfirmed: every unit
   * flagged at season start, worked down as staff check them.
   */
  const HUE = 'hsl(160 45% 42%)'

  it('fires on an unconfirmed cabin', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_confirmed: false }) })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Reconfirm space')).toBeInTheDocument()
  })

  it('is silent on a confirmed cabin, whatever its shareability says', () => {
    for (const shareability of ['shareable', 'single_party', 'unknown'] as const) {
      const view = render(
        <LodgingUnitCard
          slot={slot({ unit: unit({ is_confirmed: true, shareability }) })}
          hue={HUE}
          onOpenParty={vi.fn()}
        />
      )
      expect(screen.queryByText('Reconfirm space')).not.toBeInTheDocument()
      expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('fires on an unconfirmed cabin whose shareability IS classified', () => {
    // The two columns are independent, which is the whole point of the
    // re-gate: the old one keyed on a column with no unset rows in it.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_confirmed: false, shareability: 'shareable' }) })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Reconfirm space')).toBeInTheDocument()
  })
})

describe('LodgingUnitCard — the marks kindred#2072 STRUCK from the unit card', () => {
  /*
   * A CUT IS A RULING, and each of these is pinned negatively because this
   * codebase has twice restored an element whose absence was undefended.
   * Several of them are also cuts that were RULED EARLIER and never landed —
   * they were still in the code when this change was written.
   *
   * Every one of them survives on another surface where it still discriminates
   * (`MapUnitPopover`, the units admin table) — the split `Staff` already took.
   */
  const HUE = 'hsl(160 45% 42%)'

  it('draws no "Over capacity" pill — the red figure absorbed it', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 1 }), parties: [party({ party_size: 4 })] })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Over capacity')).not.toBeInTheDocument()
    // The figure still carries it, and still in red. The pill was the second
    // statement of one fact.
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('4/1')
    expect(screen.getByTestId('unit-occupancy').className).toContain('text-destructive')
  })

  it('draws no "N families" chip', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          parties: [party({ household_cm_id: 1 }), party({ household_cm_id: 2 })],
        })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText(/\d families/)).not.toBeInTheDocument()
  })

  it('draws no "Shared OK" or "Sharing unset" badge', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'shareable' }) })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
  })

  it('draws no "One-family space" warning chip', () => {
    // Never fired: all 23 room-sharing cards in the registry are classified
    // `shareable`. Staff know which spaces hold one family.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ shareability: 'single_party' }),
          parties: [party({ household_cm_id: 1 }), party({ household_cm_id: 2 })],
        })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('One-family space')).not.toBeInTheDocument()
  })

  it('draws no "Spans N rooms" chip', () => {
    // Dropping somebody into a container is a deliberate act, so the figure
    // needs no explaining. Measured at ZERO spanning parties after #2040.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ code: 'up-r1', parent_code: 'upstairs' }),
          parties: [party({ unit_code: 'upstairs', unit_codes: ['upstairs'] })],
        })}
        units={[
          unit({ unit_id: 'up', code: 'upstairs', is_container: true }),
          unit({ unit_id: 'r1', code: 'up-r1', parent_code: 'upstairs' }),
          unit({ unit_id: 'r2', code: 'up-r2', parent_code: 'upstairs' }),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText(/Spans \d+ rooms/)).not.toBeInTheDocument()
  })

  it('draws no "Building" badge on a combined container', () => {
    // Owner ruling 2026-08-19. `reservationBadge`'s arm survives for
    // `MapUnitPopover`'s header and its collapsed grid cell; on a board card
    // that function now draws nothing at all, so the render site is gone
    // rather than merely quiet.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_container: true, is_combined: true }) })}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Building')).not.toBeInTheDocument()
  })

  it('draws no "Staff" or "Released" badge, and no Release / Clear control', () => {
    // All 25 staff units fail `isPlanningInventory`, so no staff card is ever
    // drawn here, and `lodging_availability` is empty in every year. The whole
    // release workflow was unreachable on this board.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ inventory_class: 'staff_default', family_available_override: true }),
        })}
        hue={HUE}
        canSetAvailability={true}
        onSetAvailability={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
    expect(screen.queryByText('Released')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^release/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^clear/i })).not.toBeInTheDocument()
  })

  it('draws no "Drop families here" or "Empty" text in the well', () => {
    // At 81% of live cards empty this was the most-repeated sentence on the
    // board. The dashed border and the empty well already say it.
    render(
      <LodgingUnitCard
        slot={slot({ parties: [] })}
        hue={HUE}
        canPlace={true}
        unplacedParties={[]}
        onPlaceParty={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Drop families here')).not.toBeInTheDocument()
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  })

  it('keeps the dashed border that now carries the empty state alone', () => {
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: [] })} hue={HUE} onOpenParty={vi.fn()} />
    )
    expect(container.querySelector('[data-unit-card]')?.className).toContain('border-dashed')
  })
})

describe('LodgingUnitCard — B·1 and B·2, the card gets shorter', () => {
  /*
   * Measured together and found perfectly additive: −148px across every card
   * from the padding and gap (8.3%), and the well's `min-h-[100px]` on top of
   * it, for about −15% of column height.
   */
  const HUE = 'hsl(160 45% 42%)'

  it('drops the well’s min-height', () => {
    // B·2. The min-height lifted an empty card off its 139px floor toward the
    // 188px occupied median; with the empty-state sentence gone there is
    // nothing left in an empty well to give height to, and 81% of live cards
    // are empty.
    const { container } = render(<LodgingUnitCard slot={slot()} hue={HUE} onOpenParty={vi.fn()} />)
    const well = container.querySelector('[data-testid="occupant-well"]')
    expect(well?.className).not.toContain('min-h-[100px]')
    // `flex-1` STAYS: it is what makes the grid's stretch survivable, and it
    // is a different decision from the floor.
    expect(well?.className).toContain('flex-1')
  })

  it('tightens the card’s own padding and row rhythm', () => {
    // B·1. A DELIBERATE DIVERGENCE from summer's `p-4` / `mb-3`, and the
    // reason is topology rather than taste: a summer bunk card holds 10–14
    // campers, so 16px of padding is a small fraction of a tall card, where
    // a lodging card holds nothing or one party and the same padding is most
    // of it.
    const { container } = render(<LodgingUnitCard slot={slot()} hue={HUE} onOpenParty={vi.fn()} />)
    const card = container.querySelector('[data-unit-card]')
    expect(card?.className).toContain('p-2.5')
    expect(card?.className).toContain('px-3')
    expect(card?.className).toContain('gap-2')
    expect(card?.className).not.toContain('p-4')
    expect(card?.className).not.toContain('gap-3')
  })
})
