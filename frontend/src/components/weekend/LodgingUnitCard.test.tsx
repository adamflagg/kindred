/**
 * A slot card. One unit, holding nothing, one party, or occasionally two.
 *
 * Not a summer bunk column: a bunk column is tall because it holds 10–14
 * campers. 82 rooms cannot be 82 columns.
 *
 * Fictional data throughout.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

// `setNodeRef` is ONE stable fn, not a fresh `vi.fn()` per call — the real
// hook's setNodeRef is `useCallback([])`-stable, and a per-render fake defeats
// the shell's own `useCallback` and with it the body memo the shell exists
// for, making the memo test below pass vacuously.
const stableSetNodeRef = vi.fn()

/**
 * Counts BODY renders: `slotOccupancy` is called exactly once per
 * `LodgingUnitCardInner` render and by nothing else in this tree, so its call
 * count is the body's render count — which is how the memo tests below can
 * see a bail-out without exporting the inner component.
 */
const bodyRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./boardLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./boardLayout')>()
  return {
    ...actual,
    slotOccupancy: (...args: Parameters<typeof actual.slotOccupancy>) => {
      bodyRenders.count += 1
      return actual.slotOccupancy(...args)
    },
  }
})
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useDroppable: (args: { id: string; disabled?: boolean }) => ({
      setNodeRef: stableSetNodeRef,
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
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
    render(<LodgingUnitCard slot={slot({ unit: unit({ sleeps: null }) })} onOpenParty={vi.fn()} />)
    expect(screen.getByText('0/—')).toBeInTheDocument()
    expect(screen.queryByText('0/0')).not.toBeInTheDocument()
  })

  it('shows how many spaces the unit sleeps when it is known', () => {
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    const occupancy = screen.getByTestId('unit-occupancy')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sleeps 5/)
  })

  it('puts the capacity sentence on a tooltip keyboard and touch can reach', () => {
    // kindred#2177. The occupancy figure is the smallest trigger on the board,
    // so the primitive's transparent 24px hit target does the tap-target work
    // — NOT a drawn box, which would collide with the dashed empty-room edge.
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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

    it('does not mistake the 0.0 unknown-age sentinel for an infant', () => {
      // kindred#2212: `age: 0.0` is CampMinder's UNKNOWN-AGE sentinel, not a
      // newborn's age. The server never discounts a bed on the sentinel's
      // strength, so headcount and recorded beds AGREE for this household and
      // the exemption clause must not fire. (Re-measured 2026-08-22: zero
      // rostered 2026 children carry the sentinel and the derived rule
      // discounts 26 households -- the guard pins the RULE, not the cohort.)
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
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
            reason: '1 family did not request sharing',
          },
        })}
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })

  it('carries no area hue — the card frame is a constant in every state', () => {
    // REWRITTEN. This asserted the opposite until 2026-08-21, and §3.10's own
    // comment is why the reversal is safe rather than a loss: "the section
    // headers do the actual grouping and this degrades to decoration". Area
    // identity had FOUR carriers on the board — the `<section>`, the heading,
    // the header dot, and 73 card top-edges — and the card edge was the only
    // one on every card, always on.
    //
    // Taking it off is what frees the card's frame. No state now touches
    // `border-color`, `border-width` or the title, so every mark lives in
    // `background-color` or `background-image` and the three drag states can
    // share one channel without racing.
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    const card = container.querySelector('[data-unit-card]')
    expect(card?.getAttribute('style')).toBeNull()
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
      <LodgingUnitCard slot={slot({ unit: held })} canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('border-primary')
  })

  it('keeps an ordinary unheld unit droppable enabled (regression guard)', () => {
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(<LodgingUnitCard slot={slot()} canPlace onOpenParty={vi.fn()} />)
    expect(card(container)).toHaveClass('border-primary')
  })
})

describe('LodgingUnitCard — the split control belongs to containers only', () => {
  it('offers a split control on a combined CONTAINER', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ code: 'house', is_container: true, is_combined: true }) })}
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
  const sharedParties = [party(), party({ household_cm_id: 102, display_name: 'Garcia' })]
  const declinedConsent = {
    declinedCount: 1,
    unansweredCount: 0,
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
      <LodgingUnitCard slot={slot({ parties: sharedParties })} onOpenParty={vi.fn()} />
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
        <LodgingUnitCard slot={slot({ parties })} onOpenParty={vi.fn()} />
      )
      expect(card(container).style.boxShadow).toBe('')
      unmount()
    }
  })

  it('carries NO area hue, and no inline style at all', () => {
    // REWRITTEN, not adapted. This test used to assert the opposite — that
    // `borderTopColor` kept §3.10's secondary channel on the card — and it was
    // right until the 2026-08-21 ruling took the area colour off the card
    // entirely. The hue is not lost: the section header above each grid draws
    // it as a dot, at 8 instances instead of 73, which is where the grouping
    // actually happens (`boardLayout.ts` §3.10 says the headers do it and the
    // per-card hue "degrades to decoration").
    //
    // Asserting the ABSENCE of an inline style rather than a specific border
    // colour, because the point is that the card's frame is now a constant:
    // no state touches `border-color`, `border-width` or the title.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: sharedParties })} onOpenParty={vi.fn()} />
    )
    expect(card(container).getAttribute('style')).toBeNull()
  })

  it('promotes the consent ring to ring-2', () => {
    // Prerequisite named in #2091: the mark this test file is otherwise
    // about needs a `ring-1` consent edge promoted first, so the new mark
    // has a weight to lose to.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: sharedParties, consent: declinedConsent })}
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
      <LodgingUnitCard slot={slot({ parties: sharedParties })} canPlace onOpenParty={vi.fn()} />
    )
    expect(card(container)).toHaveClass('border-primary')
  })

  it('still dims an invalid merge target holding two families', () => {
    const room = unit({ code: 'cedar-1', parent_code: 'east-wing' })
    const draggedSibling = unit({ code: 'other-1', parent_code: 'west-wing' })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: room, parties: sharedParties })}
        mergeSourceUnit={draggedSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('opacity-40')
  })

  it('leaves a plain occupied card with no ring class at all', () => {
    // The bottom tier. `plain` has to stay reachable after the table shrinks.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: [party()] })} onOpenParty={vi.fn()} />
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
        mergeSourceUnit={draggedSibling}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('opacity-40')
    expect(card(container)).toHaveClass('border-dashed')
  })

  it('keeps the empty-room dashed cue visible under an active drop target', () => {
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(<LodgingUnitCard slot={slot()} canPlace onOpenParty={vi.fn()} />)
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
    const { container } = render(<LodgingUnitCard slot={slot()} canPlace onOpenParty={vi.fn()} />)
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

  it('leaves an OPEN unit title identical to an occupied one — the wash carries it alone', () => {
    // REWRITTEN. #2093 gave the open marker two halves, a forest wash and a
    // bold primary title, coupled to one flag so they could not drift. The
    // owner struck the title half on 2026-08-21: the wash carries the resting
    // signal by itself.
    //
    // Asserted against an OCCUPIED card rather than against literal classes,
    // because the invariant is sameness — no state touches the title, so a
    // future mark that reaches for `color` or `font-weight` fails here.
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    const openTitle = screen.getByText('Cedar 1').className
    cleanup()
    render(<LodgingUnitCard slot={slot({ parties: [party()] })} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1').className).toBe(openTitle)
  })

  it('leaves an occupied unit title in the plain foreground weight', () => {
    render(<LodgingUnitCard slot={slot({ parties: [party()] })} onOpenParty={vi.fn()} />)
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
    render(<LodgingUnitCard slot={slot()} canPlace onOpenParty={vi.fn()} />)
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
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(container.querySelector('[data-unit-card]')).toHaveClass('bg-primary/10')
  })
})

describe('the write-in occupant card (kindred#2078)', () => {
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
        canPlace
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Drop families here')).not.toBeInTheDocument()
  })

  it('draws two occupants of one shareable cabin as two SEPARATE React siblings', () => {
    /*
     * DARK ON ARRIVAL — `idx_lodging_write_in_unique` still forbids the second
     * row, so this payload is one only a fixture can build.
     *
     * The well mapped `writeIns` with `key={entry.source.unitId}`. Two covers
     * naming one unit were therefore two siblings sharing a key, which React
     * treats as a reconciliation error rather than a warning: the second
     * card's DOM is reused for the first across re-renders, so a pencil opened
     * on one occupant can redraw over the other. This asserts BOTH the render
     * and the absence of React's own duplicate-key complaint — the render
     * alone passed before, which is what made the bug invisible.
     *
     * The stacking itself is unchanged and deliberately so: `LodgingUnitCard`
     * already rules that *"a shared space is not a new KIND of card; it is a
     * card with two occupants in it"*. Nothing here invents a container for
     * them.
     */
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      render(
        <LodgingUnitCard
          slot={slot({
            unit: unit({
              sleeps: 15,
              write_ins: [
                cover({ occupant_name: 'Emma Johnson', party_size: 3 }),
                cover({ occupant_name: 'Liam Garcia', party_size: 4 }),
              ],
              occupant_name: 'Emma Johnson',
              is_family_available: true,
            }),
          })}
          canPlace
          onOpenParty={vi.fn()}
        />
      )
      expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
      expect(errors.filter((entry) => JSON.stringify(entry).includes('same key'))).toEqual([])
    } finally {
      spy.mockRestore()
    }
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
        canSetAvailability
        onSetAvailability={vi.fn()}
        onOpenParty={vi.fn()}
      />
    )

    expect(screen.getAllByText('Liam Garcia')).toHaveLength(1)
  })

  it('does not draw an occupant card on an ordinary open room', () => {
    render(<LodgingUnitCard slot={slot()} canPlace onOpenParty={vi.fn()} />)

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
   * place. It swept `UnitAvailabilityControl` too while that control still
   * rendered inside this card — a 10px pill in a 12px meta row was the same
   * bug — and it is cut as of this change (vocabulary §3); the sweep is
   * unchanged because it walks whatever the card actually renders.
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
            // The sweep is only as good as the DOM it renders; `ac_coverage`
            // is what mounts the snowflake now (kindred#2502).
            ac_coverage: 'all',
            parent_code: 'cedar-house',
            is_container: true,
            is_combined: true,
          }),
          parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })],
          consent: {
            declinedCount: 1,
            unansweredCount: 0,
            reason: 'One household declined sharing',
          },
        })}
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    expect(arbitraryTextSizes(container)).toEqual([])
  })

  it('titles the unit at summer’s text-lg', () => {
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Cedar 1', level: 3 })).toBeInTheDocument()
  })

  it('sets the capacity figure at summer’s body size', () => {
    // Summer prints `{occupancy}/{capacity}` at `text-sm`. The figure is the
    // second thing read on the card; at 11px it read as a footnote.
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
            reason: 'One household declined sharing',
          },
        })}
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
      <LodgingUnitCard slot={slot({ parties: [party({ party_size: 3 })] })} onOpenParty={vi.fn()} />
    )
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  it('distinguishes an empty room from a full one', () => {
    // The whole point: before this, both rendered "5".
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    expect(screen.getByText('0/5')).toBeInTheDocument()
  })

  it('marks a room holding more people than it sleeps', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 4 }), parties: [party({ party_size: 6 })] })}
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
      <LodgingUnitCard slot={slot({ parties: [party({ party_size: 5 })] })} onOpenParty={vi.fn()} />
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
    render(<LodgingUnitCard slot={slot({ parties: [party()] })} onOpenParty={vi.fn()} />)
    expect(screen.queryByText(/Spans/)).not.toBeInTheDocument()
  })

  it('marks a room over capacity once its recorded write-in pushes past sleeps (kindred#2503)', () => {
    // `sized` is deliberately UNCAPPED (`writeInDemand`'s doc) precisely so a
    // hand-typed write-in count above the room's own beds drives this same
    // red figure — the numerator has to carry the true recorded figure or the
    // over-capacity red never fires for it.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ sleeps: 3, write_ins: [cover({ party_size: 2 })] }),
          parties: [party({ party_size: 2 })],
        })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('4/3')
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-destructive')
  })
})

/**
 * The corner figure's numerator counts write-in people somebody actually
 * recorded (kindred#2503), and the two drag-time marks (kindred#2528) follow
 * the same fact.
 *
 * THE NO-DAY-ONE-MOVEMENT GUARD is the first test below. Every one of the 24
 * production write-in rows is unsized, so `sized` is 0 everywhere today and
 * every expression in this file has to reduce to exactly what it computed
 * before this task. If that test reds, the wholesale fallback — or an
 * ancestor's count — has leaked into the numerator.
 */
describe('LodgingUnitCard — the write-in numerator counts recorded people (kindred#2503)', () => {
  it('still draws an em dash when the only write-in on the card has no recorded size', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ party_size: null })] }) })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('—/5')
  })

  it('still prints only the placed count when an unsized write-in shares the card with a placed family', () => {
    // The routine case since kindred#2432 (the card's own comment says so):
    // an unsized write-in beside a placed family. `sized` is 0 here, so the
    // numerator must be exactly `occupants` (2), never `consumed` — a
    // `sized`/`consumed` swap in the numerator is invisible on the two tests
    // above (one short-circuits to the em dash, the other has sized ===
    // consumed) and only shows up here, where an unsized own cover falls
    // back to its own capacity for `consumed` while `sized` stays 0.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ write_ins: [cover({ party_size: null })] }),
          parties: [party({ party_size: 2 })],
        })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('2/5')
  })

  it('prints the recorded size as the numerator', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ party_size: 2 })] }) })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('2/5')
  })

  it('adds a write-in’s recorded people to a placed family’s count', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ sleeps: 15, write_ins: [cover({ party_size: 2 })] }),
          parties: [party({ party_size: 4 })],
        })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('6/15')
  })

  it('sums a descendant cover alongside the room’s own recorded size', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            sleeps: 8,
            write_ins: [
              cover({ party_size: 1 }),
              cover({
                unit_id: 'u4',
                unit_code: 'cedar-4',
                unit_name: 'Cedar 4',
                relation: 'descendant',
                party_size: 3,
              }),
            ],
          }),
        })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('4/8')
  })

  it('excludes an ancestor cover’s size — it is a fact about the house, not this room', () => {
    // Printing the house's count on this room too would spend one party twice
    // across a split house.
    //
    // A PLACED FAMILY IS REQUIRED HERE, not an empty card: with zero placed
    // occupants `wholesaleWriteIn` is true and the numerator short-circuits to
    // the em dash before the ancestor exclusion is ever evaluated, which is
    // exactly how a `sized`/`consumed` swap in the numerator survived this
    // test unnoticed. With a placed family present, `wholesaleWriteIn` is
    // false and the assertion can only pass if the numerator is built from
    // `sized` (which excludes the ancestor's 4) and not `consumed` (which
    // would include it).
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            write_ins: [cover({ relation: 'ancestor', party_size: 4, unit_sleeps: 7 })],
          }),
          parties: [party({ party_size: 2 })],
        })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('2/5')
  })

  it('mentions the recorded write-in count in the tooltip alongside placed families', () => {
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ sleeps: 15, write_ins: [cover({ party_size: 2 })] }),
          parties: [party({ party_size: 4 })],
        })}
        onOpenParty={vi.fn()}
      />
    )
    const occupancy = screen.getByTestId('unit-occupancy')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sleeps 15 · 4 placed · 2 written in')
  })

  it('leaves the wholesale tooltip sentence alone when nobody recorded a size', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ party_size: null })] }) })}
        onOpenParty={vi.fn()}
      />
    )
    const occupancy = screen.getByTestId('unit-occupancy')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Written in — occupies the whole room · sleeps 5'
    )
  })

  it('keeps the infant exemption keyed to placed occupants, not the write-in-inclusive total', () => {
    // `totalHeadcount` sums only `slot.parties` (kindred#2212) — a write-in is
    // not a party and is never in it, so the exemption must not be computed
    // against `occupants + sized` or a written-in person would be double
    // counted as a phantom infant exemption.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({ sleeps: 15, write_ins: [cover({ party_size: 2 })] }),
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
        })}
        onOpenParty={vi.fn()}
      />
    )
    const occupancy = screen.getByTestId('unit-occupancy')
    fireEvent.focus(occupancy)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Sleeps 15 · 2 placed · 2 written in · an infant is exempt from the bed count'
    )
  })
})

describe('LodgingUnitCard — drag-time capacity follows the write-in count (kindred#2503, kindred#2528)', () => {
  /*
   * ⚠️ THE CARD STOPPED WITHHOLDING ON A PARTLY-SIZED WRITE-IN (kindred#2543,
   * owner ruling 2026-08-29: *"it should subsume its leaf as it does today,
   * but also reflect that in the stats bar"*).
   *
   * These cards used to go quiet whenever any cover was unsized, while the
   * stats bar published a remainder for the very same card — one screen, two
   * answers. The arithmetic did not move: an unsized cover still contributes
   * the whole capacity of the unit it NAMES, so what the card publishes is a
   * FLOOR. A party cannot exceed the leaf it is sleeping in, so the number can
   * only understate what is free, never overstate it, and the owner accepts
   * that undercount: *"if that slightly undercounts 'real' availability, staff
   * will know that when looking over the shared cabins."*
   *
   * WHAT STILL WITHHOLDS is the card nobody has MEASURED — `consumed` there is
   * returned as 0 with no capacity to subtract it from, so it means nothing.
   * That is the one of `known`'s three meanings the ruling does not touch, and
   * the last two tests in this block are what hold it.
   */
  it('publishes the floor a partly-sized card leaves, rather than withholding it', () => {
    // Eight beds, one cover recorded at 2, one unsized cover on a measured
    // room of 3 — so 5 are taken and 3 are left. That 3 is exactly what
    // `free_family_spots` publishes to the stats bar for this card.
    const partlySized = () =>
      slot({
        unit: unit({
          sleeps: 8,
          write_ins: [
            cover({ party_size: 2 }),
            cover({ unit_id: 'u5', party_size: null, unit_sleeps: 3 }),
          ],
        }),
      })
    render(
      <LodgingUnitCard
        slot={partlySized()}
        draggingParty={party({ party_size: 4 })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-destructive')

    cleanup()
    render(
      <LodgingUnitCard
        slot={partlySized()}
        draggingParty={party({ party_size: 3 })}
        onOpenParty={vi.fn()}
      />
    )
    // The boundary is `<`, so a party that exactly fills what is left FITS.
    expect(screen.getByTestId('unit-occupancy')).not.toHaveClass('text-destructive')
  })

  it('reddens the figure once a sized write-in leaves too few beds for the family in flight', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 4, write_ins: [cover({ party_size: 2 })] }) })}
        draggingParty={party({ party_size: 3 })}
        onOpenParty={vi.fn()}
      />
    )
    // 4 beds, 2 already recorded as written in, 2 free — the 3-person family
    // in flight does not fit.
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-destructive')
  })

  it('treats an ancestor cover as a KNOWN whole-card claim, even though it is unreachable in production today', () => {
    // Unreachable because an ancestor cover requires a written-into container
    // that is not itself combined, and the snapshot's only written-into
    // container is combined — but the rule must hold in isolation: an
    // ancestor's whole-card claim IS a fact (the house is let whole), so
    // `known` does not wait on any other cover being sized.
    render(
      <LodgingUnitCard
        slot={slot({
          unit: unit({
            sleeps: 4,
            write_ins: [cover({ relation: 'ancestor', party_size: 4, unit_sleeps: 4 })],
          }),
        })}
        draggingParty={party({ party_size: 1 })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-destructive')
  })

  it('still withholds the claim on a written-into room nobody has measured', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: null, write_ins: [cover({ party_size: 2 })] }) })}
        draggingParty={party({ party_size: 1 })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).not.toHaveClass('text-destructive')
  })

  it('still withholds the claim on an unmeasured room with no write-in at all', () => {
    // THE REGRESSION THIS TASK RISKS MOST: `writeInDemand([])`'s own `known`
    // is vacuously true with no covers, independent of capacity. Folding it
    // into `dragCapacity.known` without ALSO gating on `capacityKnown` would
    // read an unmeasured, uncovered room as a known zero free beds.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: null }) })}
        draggingParty={party({ party_size: 1 })}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).not.toHaveClass('text-destructive')
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    // B·2: the min-height is struck and `flex-1` is not. They were always two
    // decisions — the floor lifted an empty card toward the occupied median,
    // and `flex-1` is what makes the grid's stretch survivable at all.
    expect(well(container)).not.toHaveClass('min-h-[100px]')
    expect(well(container)).toHaveClass('flex-1')
  })

  it('gives an occupied slot the same well, so rows agree', () => {
    // Same element in both branches on purpose. Two wells drift.
    const { container } = render(
      <LodgingUnitCard slot={slot({ parties: [party()] })} onOpenParty={vi.fn()} />
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    const card = container.querySelector('[data-unit-card]')
    expect(card).toHaveClass('gap-2')
    expect(card).not.toHaveClass('gap-3')
  })

  it('spaces two parties on summer’s 8px roster rhythm', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ parties: [party(), party({ household_cm_id: 102, display_name: 'Garcia' })] })}
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
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
  })

  it('says nothing on a one-family room either', () => {
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    const some = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'some' }) })}
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
    expect(tight).toContain('hsl(var(--foreground)_/_0.06)')
    expect(wide).toContain('hsl(var(--foreground)_/_0.06)')
    expect(some.container.querySelector('[data-unit-card]')).toHaveAttribute(
      'data-needs-fit',
      'partial'
    )
  })

  it('never dims — the hatch is advisory and a dim is a refusal', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
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
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(hatchClass(container)).toBe('')
  })

  it('SUPPRESSES the open-space forest tint — a conflict is not an invitation', () => {
    // REWRITTEN, and it reverses. The old rule let the two compose because
    // they sit on orthogonal properties: the tint is `background-color`, the
    // hatch `background-image`. That was true and it was the wrong call — the
    // card said "drop here" and "no" at once, and drawn at board scale the
    // composite read as a dull, deactivated grey rather than a warning.
    //
    // The owner ruled on 2026-08-21 that the negative wins. A conflict now
    // gains the hazard texture AND loses the invitation, which is two halves
    // of one mark rather than two marks arguing. It is decided at
    // `dragFit.state` — one enum, one winner — not by two CSS rules racing
    // over a byte offset, which is the collapse `RING_CLASSES` exists to kill.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ power_coverage: 'none' }) })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).not.toHaveClass('bg-primary/10')
    expect(card(container)).not.toHaveClass('bg-primary/20')
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
      partySize: null,
      // kindred#2583 step 4. A CREATE renames nobody, and says so rather than
      // leaving the field off: the pencil's edit is the one that carries a
      // name here, and a producer that forgets the field would turn that
      // compare-and-swap into the create this one legitimately is.
      previousOccupantName: null,
    })
  })

  it('sends the People count typed in the modal, through the same write', async () => {
    // kindred#2503, thread-through check: the modal's own unit tests pin the
    // parsing rule; this is the one hop that would silently drop the field on
    // its way to `onSetAvailability` if a caller forgot to forward it.
    const user = userEvent.setup()
    const onSetAvailability = vi.fn()
    renderCard({ canSetAvailability: true, onSetAvailability })
    await user.click(assignPill())
    await user.type(screen.getByRole('searchbox'), 'Burst pipe')
    // `selectOptions`, not `type` — People is a `<select>` since 2026-08-23
    // (kindred#2540) and `user.type` does not drive one.
    await user.selectOptions(screen.getByLabelText('People'), '2')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))
    expect(onSetAvailability).toHaveBeenCalledWith({
      unitId: 'u1',
      unitName: 'Cedar 1',
      familyAvailable: false,
      occupantName: 'Burst pipe',
      reason: '',
      partySize: 2,
      previousOccupantName: null,
    })
  })

  it("preserves the pencil-edited row's already-recorded party size, never dropping it", async () => {
    // MAJOR A. `set_availability` upserts `party_size` on EVERY write-in
    // write, so an edit that sent `null` here would silently erase a count a
    // staff member had already recorded. Mutation-checked: hardcoding
    // `partySize: null` at the `onEdit` call site in `LodgingUnitCard.tsx`
    // leaves this red.
    //
    // ⚠️ THE GUARD MOVED AND THIS COMMENT NAMED THE OLD ONE (kindred#2540
    // final scan, FINDING 6). It said "`WriteInCard`'s edit form does not ask
    // about party size yet (kindred#2503's own edit form is a later task)" --
    // written by `4010cb52` and invalidated by `d419d4f7` ONE COMMIT LATER,
    // then carried 22 commits. The pencil has asked since, and
    // `LodgingUnitCard.tsx` says so at its own `onEdit`. So what this pins is
    // no longer "the form omits the field" but "the form round-trips the
    // seeded value untouched" -- a reader following the old sentence would
    // hunt the preserve-on-edit guard in the wrong file.
    const user = userEvent.setup()
    const onSetAvailability = vi.fn()
    renderCard({
      canSetAvailability: true,
      onSetAvailability,
      slot: slot({ unit: unit({ write_ins: [cover({ party_size: 3 })] }) }),
    })
    await user.click(screen.getByRole('button', { name: 'Edit write-in Emma Johnson' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSetAvailability).toHaveBeenCalledWith({
      unitId: 'u1',
      unitName: 'Cedar 1',
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
      partySize: 3,
      // THE ROW THE PENCIL LOADED (kindred#2583 step 4). Same value as
      // `occupantName` because this edit did not change the name — and it is
      // sent anyway, deliberately: an unchanged name is still a
      // compare-and-swap, which is what makes the save refuse when the row
      // moved under the card instead of quietly writing a new one.
      previousOccupantName: 'Emma Johnson',
    })
  })

  it('swaps on the name the form OPENED with, not on the one the row has grown since', async () => {
    /*
     * ⚠️ THE COMPARE-AND-SWAP'S ONE JOB, and reading the live prop at submit
     * time hands it back. Every comment on this path says
     * `previousOccupantName` is "the name the pencil LOADED"; the closure read
     * `entry.occupant.name` from the CURRENT render instead, and the two are
     * only the same string while nothing moves underneath.
     *
     * The window is real and is the exact one the field exists for. `WriteInCard`
     * seeds its drafts at `openEdit` and never re-seeds, and the well keys its
     * cards on `entry.key` (the unit id) rather than on the occupant's name --
     * stated there so "renaming an occupant does not remount their card
     * mid-edit". Any board mutation calls `invalidateLodgingRegistryQueries`, so
     * a refetch can deliver a rename while the pencil is open: the form still
     * shows what was loaded, the props already carry the new name.
     *
     * Reading the fresh one made the swap resolve the OTHER staff member's row
     * and overwrite their rename, which is the silent double-write the 409
     * exists to refuse. The loaded name comes back out of the form that loaded
     * it instead.
     */
    const user = userEvent.setup()
    const onSetAvailability = vi.fn()
    const { rerender } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ occupant_name: 'Emma Johnson' })] }) })}
        canPlace={true}
        unplacedParties={[unplaced]}
        onPlaceParty={vi.fn()}
        onOpenParty={vi.fn()}
        canSetAvailability={true}
        onSetAvailability={onSetAvailability}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Edit write-in Emma Johnson' }))

    // Somebody else renames the row, and the roster refetch lands while this
    // form is open. The card does not remount, so the draft survives.
    rerender(
      <LodgingUnitCard
        slot={slot({ unit: unit({ write_ins: [cover({ occupant_name: 'Emma Johnston' })] }) })}
        canPlace={true}
        unplacedParties={[unplaced]}
        onPlaceParty={vi.fn()}
        onOpenParty={vi.fn()}
        canSetAvailability={true}
        onSetAvailability={onSetAvailability}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSetAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        occupantName: 'Emma Johnson',
        // The name the form LOADED. It no longer resolves, which is the
        // point: the server answers 409 and nobody's rename is lost.
        previousOccupantName: 'Emma Johnson',
      })
    )
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
    // ⚠️ SCOPED TO THE CARD'S OWN CHROME, not the whole card (kindred#2540
    // final scan, FINDING 7). `queryByRole('combobox')` was a unique proxy
    // for `PlaceFamilyPicker` until 2026-08-23, when the write-in pencil's
    // `People` field became a native `<select>` -- which carries the implicit
    // role `combobox` and mounts INSIDE this card. The bare query passes here
    // only because this fixture has no write-in and the pencil starts closed,
    // so it is vacuous for a legitimate card state and a future test that
    // opens a pencil would red it for a reason unrelated to the struck
    // picker. Excluding the People control keeps the pin pointed at the
    // typeahead it was written for. This is the sibling of the `option`-role
    // collision repaired in `AssignFamilyModal.test.tsx`.
    const comboboxes = screen
      .queryAllByRole('combobox')
      .filter((el) => el.getAttribute('aria-label') !== 'People')
    expect(comboboxes).toHaveLength(0)
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
    const { container } = render(<LodgingUnitCard slot={infantSlot} onOpenParty={vi.fn()} />)
    expect(container.querySelectorAll('.sr-only')).toHaveLength(0)
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0)
  })

  it('keeps the occupancy sentence OUT of the DOM until the bubble is opened', () => {
    // The measured defect: find-in-page matched `infant` four times on the
    // Housing tab and highlighted nothing, because `ui/Tooltip` mirrored
    // every closed bubble's sentence into an `sr-only` span.
    render(<LodgingUnitCard slot={infantSlot} onOpenParty={vi.fn()} />)
    expect(screen.queryByText(/exempt from the bed count/)).not.toBeInTheDocument()
    fireEvent.focus(screen.getByTestId('unit-occupancy'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Sleeps 5 · 2 placed · an infant is exempt from the bed count'
    )
  })
})

describe('LodgingUnitCard — the write-in chip, dropped in favour of the well (kindred#2252)', () => {
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
    render(<LodgingUnitCard slot={slot({ unit: WRITTEN_IN })} onOpenParty={vi.fn()} />)

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
  const renderUnit = (overrides: Partial<LodgingUnitRow>) =>
    render(<LodgingUnitCard slot={slot({ unit: unit(overrides) })} onOpenParty={vi.fn()} />)

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

  /*
   * ⚠️ THE AC MARK READS `ac_coverage`, NOT THE RAW `has_ac` — kindred#2502.
   *
   * The plug two lines above it moved to a resolved coverage field at
   * kindred#2072, for a reason stated in the card itself: the raw flag drew no
   * plug on twelve entirely-powered buildings. AC had no resolver at all until
   * this branch added one, so it kept the raw read and kept the bug — and the
   * server's own count is the measurement, not an analogy:
   * `_resolve_ac_coverage` records that SEVEN of the 15 production containers
   * carry `has_ac = 0` with AC-bearing rooms.
   *
   * kindred#2502 named THREE surfaces reading it raw. `MapUnitPopover` and
   * `AssignFamilyModal` both moved to `ac_coverage`; this card is the third
   * and was the one left behind, so the modal a staff member opens FROM this
   * card printed "air conditioning" while the card itself drew no snowflake.
   * That is the same contradiction kindred#2501 closed on the bathroom axis,
   * one dimension over.
   *
   * `some` DRAWS THE MARK, which is the plug's rule and not a new one: the
   * amenity mark says the building offers it somewhere, and whether it reaches
   * a particular family is the need glyph's question. AC has no need glyph —
   * 0 of 184 housing narratives mention it — so there is no demand side to
   * contradict.
   */
  it('draws the snowflake for a BUILDING whose rooms have AC but whose own row does not', () => {
    const { container } = renderUnit({
      has_ac: false,
      ac_coverage: 'all',
      is_container: true,
      is_combined: true,
    })
    expect(container.querySelector('[data-testid="amenity-ac"]')).not.toBeNull()
  })

  it('draws it when only SOME rooms have AC, as the plug does for power', () => {
    const { container } = renderUnit({ has_ac: false, ac_coverage: 'some' })
    expect(container.querySelector('[data-testid="amenity-ac"]')).not.toBeNull()
  })

  it('never claims AC from the raw flag the resolved field arbitrates', () => {
    // The raw twin set to the OPPOSITE of the resolved answer, so the test
    // proves which one is read rather than merely agreeing with both.
    const { container } = renderUnit({ has_ac: true, ac_coverage: 'none' })
    expect(container.querySelector('[data-testid="amenity-ac"]')).toBeNull()
  })

  it('says nothing about AC nobody has recorded', () => {
    // `unknown` is "nothing answers" — a blank field or a container with no
    // active room left, NOT an unconfirmed row (kindred#2526) — and the mark
    // asserts presence, the same reading the bathroom and power marks take.
    const { container } = renderUnit({ has_ac: true, ac_coverage: 'unknown' })
    expect(container.querySelector('[data-testid="amenity-ac"]')).toBeNull()
  })

  /*
   * ⚠️ THE FRIDGE MARK, kindred#2327 — render-only, because `has_fridge` and
   * its `fridge_coverage` grain already ship (kindred#2224, kindred#2462) and
   * `MapUnitPopover.tsx` already draws it with `Refrigerator`. This card was
   * the one surface left disagreeing with the map: it drew AC and power but
   * not the fridge the popover a staff member opens FROM this card shows —
   * the same contradiction kindred#2502 closed on the AC axis, one amenity
   * over. Same rule as power and AC: `fridge_coverage`, never the raw
   * `has_fridge`, and PRESENCE, so `some` draws it — no half-fill, matching
   * the shipped grammar of the other three marks in this row.
   */
  it('draws the fridge for a BUILDING whose rooms have one but whose own row does not', () => {
    const { container } = renderUnit({
      has_fridge: false,
      fridge_coverage: 'all',
      is_container: true,
      is_combined: true,
    })
    expect(container.querySelector('[data-testid="amenity-fridge"]')).not.toBeNull()
  })

  it('draws it when only SOME rooms have a fridge, as the plug does for power', () => {
    const { container } = renderUnit({ has_fridge: false, fridge_coverage: 'some' })
    expect(container.querySelector('[data-testid="amenity-fridge"]')).not.toBeNull()
  })

  it('never claims a fridge from the raw flag the resolved field arbitrates', () => {
    // The raw twin set to the OPPOSITE of the resolved answer, so the test
    // proves which one is read rather than merely agreeing with both.
    const { container } = renderUnit({ has_fridge: true, fridge_coverage: 'none' })
    expect(container.querySelector('[data-testid="amenity-fridge"]')).toBeNull()
  })

  it('says nothing about a fridge nobody has recorded', () => {
    const { container } = renderUnit({ has_fridge: true, fridge_coverage: 'unknown' })
    expect(container.querySelector('[data-testid="amenity-fridge"]')).toBeNull()
  })

  it('keeps the title, the amenities and the occupancy figure on ONE row', () => {
    const { container } = renderUnit({
      bathroom: 'shared',
      has_power: true,
      power_coverage: 'all',
      // `ac_coverage`, not the raw `has_ac`, since kindred#2502 — this was
      // `has_ac: true` alone, which no longer draws the third icon this test
      // counts. The VEHICLE changed; the one-row layout under test did not.
      has_ac: true,
      ac_coverage: 'all',
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
  it('carries Assign, Merge and Split together, below the well', () => {
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ parent_code: 'house', is_container: false }) })}
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
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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

  it('draws NO meta row on an ordinary card', () => {
    render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    expect(screen.queryByTestId('unit-meta')).not.toBeInTheDocument()
  })

  it('draws it for a deactivated room somebody is still in', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ is_active: false }), parties: [party()] })}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(screen.getByTestId('unit-meta')).getByText('Inactive')).toBeInTheDocument()
  })

  it('draws it for a cabin nobody has checked this season', () => {
    render(
      <LodgingUnitCard slot={slot({ unit: unit({ is_confirmed: false }) })} onOpenParty={vi.fn()} />
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

  it('fires on an unconfirmed cabin', () => {
    render(
      <LodgingUnitCard slot={slot({ unit: unit({ is_confirmed: false }) })} onOpenParty={vi.fn()} />
    )
    expect(screen.getByText('Reconfirm space')).toBeInTheDocument()
  })

  it('is silent on a confirmed cabin, whatever its shareability says', () => {
    for (const shareability of ['shareable', 'single_party', 'unknown'] as const) {
      const view = render(
        <LodgingUnitCard
          slot={slot({ unit: unit({ is_confirmed: true, shareability }) })}
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

  it('draws no "Over capacity" pill — the red figure absorbed it', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 1 }), parties: [party({ party_size: 4 })] })}
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
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText(/\d families/)).not.toBeInTheDocument()
  })

  it('draws no "Shared OK" or "Sharing unset" badge', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ shareability: 'shareable' }) })}
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
      <LodgingUnitCard slot={slot({ parties: [] })} onOpenParty={vi.fn()} />
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

  it('drops the well’s min-height', () => {
    // B·2. The min-height lifted an empty card off its 139px floor toward the
    // 188px occupied median; with the empty-state sentence gone there is
    // nothing left in an empty well to give height to, and 81% of live cards
    // are empty.
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
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
    const { container } = render(<LodgingUnitCard slot={slot()} onOpenParty={vi.fn()} />)
    const card = container.querySelector('[data-unit-card]')
    expect(card?.className).toContain('p-2.5')
    expect(card?.className).toContain('px-3')
    expect(card?.className).toContain('gap-2')
    expect(card?.className).not.toContain('p-4')
    expect(card?.className).not.toContain('gap-3')
  })
})

describe('LodgingUnitCard — the denominator is the WHOLE space (owner ruling 2026-08-20)', () => {
  /*
   * ⚠️ THE CARD AND THE ASSIGN MODAL DISAGREED ABOUT THE SAME ROOM, and the
   * card was the one that was wrong. Its denominator was the RAW `unit.sleeps`,
   * which under kindred#2041's delta ruling is a container's beds in space
   * belonging to no single room — not the house. All 15 production containers
   * record 0 there, which the API maps to `null`, so every combined house drew
   * `3/—`: "capacity not recorded", about a building whose rooms are measured.
   * The modal opened FROM that card read `effectiveSleeps` and said, correctly,
   * "4 of 7 beds free".
   *
   * Ruled 2026-08-20: *"the card should always show the denominator of total
   * possible sleeps — whether that is a leaf, or a container sum. The modal is
   * always the available diff. Both respect leaf vs container with subleaves."*
   *
   * `effectiveSleeps` is that number and is already the board's answer
   * elsewhere — `countUnmeasuredSpaces`, `mapModel`'s peek and the Assign
   * modal's header all read it. This card was the last reader of the raw
   * value. It is a MIRROR of `_effective_sleeps` in
   * `api/services/lodging_roster_service.py`; keep the two in step.
   *
   * ⚠️ FOR A LEAF THIS IS A NO-OP, and that is load-bearing rather than
   * incidental: `effectiveSleeps` returns `unit.sleeps` unchanged for anything
   * that is not a container, so 103 of the 118 registry rows draw exactly what
   * they drew before. The negative pins below are what hold that.
   */
  const house = unit({
    unit_id: 'u-house',
    code: 'gt-house',
    name: 'Granite House',
    sleeps: null,
    is_container: true,
    is_combined: true,
  })
  const roomA = unit({
    unit_id: 'u-ga',
    code: 'gt-a',
    name: 'Granite A',
    sleeps: 3,
    parent_code: 'gt-house',
  })
  const roomB = unit({
    unit_id: 'u-gb',
    code: 'gt-b',
    name: 'Granite B',
    sleeps: 4,
    parent_code: 'gt-house',
  })
  const registry = [house, roomA, roomB]

  it('totals a combined house rather than printing an em dash about it', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: house, parties: [party({ party_size: 3, unit_code: 'gt-house' })] })}
        units={registry}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('3/7')
    expect(screen.queryByText('3/—')).not.toBeInTheDocument()
  })

  it('leaves a leaf’s own figure exactly as it was', () => {
    // The no-op half of the ruling. `effectiveSleeps` short-circuits on
    // anything that is not a container, so this must not move.
    render(
      <LodgingUnitCard
        slot={slot({ unit: unit({ sleeps: 5 }), parties: [party({ party_size: 3 })] })}
        units={[unit({ sleeps: 5 })]}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('3/5')
  })

  it('still refuses a total when one active room is unmeasured', () => {
    // The refusal survives the change and is the reason the em dash exists at
    // all: one unmeasured active room leaves the whole house unknown, and a
    // partial sum would be a confident wrong number.
    const unmeasured = unit({
      unit_id: 'u-gc',
      code: 'gt-c',
      sleeps: null,
      parent_code: 'gt-house',
    })
    render(
      <LodgingUnitCard
        slot={slot({ unit: house, parties: [party({ party_size: 3, unit_code: 'gt-house' })] })}
        units={[house, roomA, unmeasured]}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('3/—')
  })

  it('grades over-capacity against the whole house, not against the container row', () => {
    // The other half of reading the right number: a house whose rooms sleep 7
    // IS over capacity at 9, and used to escape the verdict entirely because
    // `capacityKnown` was false on a null container row.
    render(
      <LodgingUnitCard
        slot={slot({ unit: house, parties: [party({ party_size: 9, unit_code: 'gt-house' })] })}
        units={registry}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).toHaveTextContent('9/7')
    expect(screen.getByTestId('unit-occupancy')).toHaveClass('text-destructive')
  })

  it('does not call a whole-house let over capacity when it fits', () => {
    render(
      <LodgingUnitCard
        slot={slot({ unit: house, parties: [party({ party_size: 7, unit_code: 'gt-house' })] })}
        units={registry}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByTestId('unit-occupancy')).not.toHaveClass('text-destructive')
  })
})

/**
 * The drag-time signal's two NEW marks (kindred#2528).
 *
 * The hatch above is the negative half and predates this. What is new is the
 * positive half — a match, drawn as the resting wash at double strength — and
 * the capacity figure turning red. Between them the card now answers "does
 * this family go here?" in three states rather than two.
 *
 * Fictional data throughout.
 */
describe('LodgingUnitCard — the drag-time match and the capacity red', () => {
  const needsPower = party({ flags: { needs_power: true }, party_size: 2 })
  const asksNothing = party({ party_size: 6 })

  function card(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[data-unit-card]')
    if (!el) throw new Error('no card rendered')
    return el as HTMLElement
  }
  const powered = (over: Partial<LodgingUnitRow> = {}) =>
    unit({ power_coverage: 'all', has_power: true, sleeps: 6, ...over })

  it('washes a matching cabin at double the resting strength', () => {
    // The match is MORE OF THE GREEN THE BOARD ALREADY SPEAKS, not a new hue.
    // #1912: the board's hues are committed, so a fifth meaning cannot have a
    // fifth colour. 10% at rest, 20% for a match — one channel, one job.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered() })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('bg-primary/20')
    expect(card(container)).not.toHaveClass('bg-primary/10')
  })

  it('leaves an empty cabin at its resting 10% when there is nothing to say', () => {
    // The third state. An empty cabin that neither conflicts nor matches is
    // drawn EXACTLY as it was at rest, so a drag changes nothing it has
    // nothing to say about. Here: powered, so no conflict; too small for the
    // party, so no match.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 1 }) })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('bg-primary/10')
    expect(card(container)).not.toHaveClass('bg-primary/20')
  })

  it('never matches a cabin for a family that asked for nothing', () => {
    // The withhold rule, at the card. 368 of 479 2026 registrations ask no
    // housing need; the board must not light up for them.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 10 }) })}
        draggingParty={party({ party_size: 2 })}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).not.toHaveClass('bg-primary/20')
    expect(card(container)).toHaveClass('bg-primary/10')
  })

  it('reddens for a family that asked for NOTHING, whose board is otherwise silent', () => {
    // Deliberately not gated on the mode switch. A family with no requirements
    // never moves the board out of its resting state, but "you will not fit
    // here" is still true and is the only question they have.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 2 }) })}
        draggingParty={asksNothing}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).not.toHaveClass('bg-primary/20')
    expect(within(card(container)).getByText('0/2')).toHaveClass('text-destructive')
  })

  it('keeps the figure at its OWN numbers — the party in flight is never added in', () => {
    // The card goes on reporting who is actually placed. Adding the dragged
    // party would make the figure a projection, and N/M has always described
    // placed people.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 4 }), parties: [party({ party_size: 3 })] })}
        draggingParty={asksNothing}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(card(container)).getByText('3/4')).toBeInTheDocument()
  })

  it('leaves the figure alone when nobody has measured the cabin', () => {
    // The one thing the board does not know. Never claim from it.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: null }) })}
        draggingParty={asksNothing}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(card(container)).getByText('0/—')).not.toHaveClass('text-destructive')
  })

  it('yields the wash to the drop ring on a matching cabin under the cursor', () => {
    // BOTH set `background-color`. Without the guard a matching card that is
    // also the active drop target puts `bg-primary/20` and `RING_CLASSES`'
    // `bg-primary/5` in one class list and lets the emitted stylesheet order
    // decide — the byte-offset race `RING_CLASSES` exists to kill, and the
    // same reason `openMarkerActive` has always stood down for a drop target.
    //
    // The ring wins: "you are here" outranks "this cabin is like this".
    overDroppableId = unitDroppableId('cedar-1')
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered() })}
        draggingParty={needsPower}
        canPlace
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('bg-primary/5')
    expect(card(container)).not.toHaveClass('bg-primary/20')
  })

  it('never matches a room somebody is written into', () => {
    // UNCHANGED BY kindred#2543, and now true for a better reason. This used
    // to hold because the card withheld every claim about a card with an
    // unsized cover. It holds now because the arithmetic says so: an unsized
    // cover on a leaf nobody measured takes the WHOLE cabin, so there are no
    // beds left to match into. Washing green at double the resting tint on a
    // room with nothing free would be the loudest possible contradiction of
    // the em dash beside it.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 5, write_ins: [cover()] }) })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).not.toHaveClass('bg-primary/20')
  })

  it('never matches a card whose party straddles beyond it', () => {
    // The third leg of `dragCapacity.known`, pinned separately because
    // mutation-testing found it was the only one that could be deleted with
    // the suite still green. A straddling placement makes the card's occupant
    // count an UPPER BOUND, not a fact (`slotOccupancy`), and a positive
    // claim must not be built on one — even with beds apparently to spare.
    const straddler = party({
      party_size: 2,
      unit_code: 'cedar-1',
      unit_codes: ['cedar-1', 'elsewhere-9'],
    })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 20 }), parties: [straddler] })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).not.toHaveClass('bg-primary/20')
  })

  it('does not redden a card whose party straddles beyond it, either', () => {
    // Same bound, negative direction: "you will not fit" asserted from an
    // occupant count that is not a fact would be as false as the match.
    const straddler = party({
      party_size: 2,
      unit_code: 'cedar-1',
      unit_codes: ['cedar-1', 'elsewhere-9'],
    })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 2 }), parties: [straddler] })}
        draggingParty={asksNothing}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(card(container)).getByText(/\/2$/)).not.toHaveClass('text-destructive')
  })

  it('reddens a room somebody is written into, em-dash numerator and all', () => {
    // ⚠️ REVERSED BY kindred#2543 — this test used to assert the opposite, on
    // the argument that reddening the figure would "assert no room from the
    // very number the card refuses to state". The two halves of the figure
    // answer different questions and only one of them is missing: the
    // NUMERATOR is `sized`, which is an em dash because nobody recorded a
    // headcount, while the RED is `free`, which comes from `consumed` — and
    // `consumed` here is the whole cabin, because an unsized cover on a leaf
    // nobody measured takes everything. 0 free is what the stats bar
    // publishes for this card; the board now says the same thing.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 2, write_ins: [cover()] }) })}
        draggingParty={asksNothing}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(card(container)).getByText('—/2')).toHaveClass('text-destructive')
  })

  it('washes a partly-sized write-in card that the family in flight still fits', () => {
    // The positive half of the same ruling (kindred#2543). Ten beds, one
    // cover recorded at 2 and one unsized cover on a measured room of 3, so
    // five are left — and a two-person family that asked for power goes in a
    // powered cabin with five beds spare. The board used to withhold this
    // match while the stats bar counted those same five beds as free.
    const { container } = render(
      <LodgingUnitCard
        slot={slot({
          unit: powered({
            sleeps: 10,
            write_ins: [
              cover({ party_size: 2 }),
              cover({ unit_id: 'u5', party_size: null, unit_sleeps: 3 }),
            ],
          }),
        })}
        draggingParty={needsPower}
        onOpenParty={vi.fn()}
      />
    )
    expect(card(container)).toHaveClass('bg-primary/20')
  })

  it('does not tell the family they will not fit in the cabin they are in', () => {
    // Moving a PLACED family between cabins is the board's core operation, so
    // the dragged party is routinely already an occupant of some card. Its own
    // beds must not count against it there, or its current cabin reddens to
    // say it will not fit somewhere it demonstrably does.
    const staying = party({ party_size: 3 })
    const { container } = render(
      <LodgingUnitCard
        slot={slot({ unit: powered({ sleeps: 3 }), parties: [staying] })}
        draggingParty={staying}
        onOpenParty={vi.fn()}
      />
    )
    expect(within(card(container)).getByText('3/3')).not.toHaveClass('text-destructive')
  })

  it('does not redden at rest, when no family is in flight', () => {
    const { container } = render(
      <LodgingUnitCard slot={slot({ unit: powered({ sleeps: 2 }) })} onOpenParty={vi.fn()} />
    )
    expect(within(card(container)).getByText('0/2')).not.toHaveClass('text-destructive')
  })
})

describe('LodgingUnitCard — the shell/body split actually bails (perf)', () => {
  /*
   * The whole point of the shell is that dnd-kit's context churn re-renders
   * the SHELL on every `over` flip while the memo'd body stands still. The
   * split has already been silently defeated twice — inline `useSensor`
   * options and `useUnitMerge`'s unstable `setCombined`, each a fresh prop
   * identity on every render — and 7,000+ tests stayed green both times,
   * because nothing asserted the bail-out itself. These do. The control case
   * proves the counter can see a real re-render, so a pass is not vacuous.
   */
  it('a re-render with identical props does not re-run the body', () => {
    const theSlot = slot()
    const onOpenParty = vi.fn()
    const view = render(<LodgingUnitCard slot={theSlot} onOpenParty={onOpenParty} />)
    const before = bodyRenders.count
    view.rerender(<LodgingUnitCard slot={theSlot} onOpenParty={onOpenParty} />)
    expect(bodyRenders.count).toBe(before)
  })

  it('control: a changed prop identity DOES re-run the body', () => {
    const theSlot = slot()
    const view = render(<LodgingUnitCard slot={theSlot} onOpenParty={vi.fn()} />)
    const before = bodyRenders.count
    view.rerender(<LodgingUnitCard slot={theSlot} onOpenParty={vi.fn()} />)
    expect(bodyRenders.count).toBeGreaterThan(before)
  })
})
