/**
 * The family card is the board's atom — a household of mixed ages, not a
 * camper.
 *
 * The load-bearing tests here are the ABSENCES. Spec §3.8 keeps three things
 * off the card, each for a measured reason, and each is the kind of thing a
 * later session would helpfully add back:
 *
 *   - request text: 12 of 232 contain health vocabulary including a named
 *     diagnosis, and the roster's PHI exposure was accepted for opening ONE
 *     row at a time, not for printing it across 62 cards at once;
 *   - the medical affordance: true for 62 of 62 parties;
 *   - `needs_resolution`: true for 44 of 62.
 *
 * A flag that is always on is not a flag.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyCard, FamilyCardPreview } from './FamilyCard'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [
      { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
      { person_cm_id: 9002, display_name: 'Ava Johnson', age: 5, grade: 0 },
    ],
    party_size: 4,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

function confirmedUnit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
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
    is_confirmed: true,
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

const REQUEST_TEXT = 'Please put us near the Garcia family, and we need a ground-floor room.'

describe('FamilyCard — what it shows', () => {
  it('names the household and its size', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByText('Johnson')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('shows children with ages, which is the entire point of a similar-ages match', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByText(/Noah/)).toBeInTheDocument()
    expect(screen.getByText(/8/)).toBeInTheDocument()
    expect(screen.getByText(/Ava/)).toBeInTheDocument()
    expect(screen.getByText(/5/)).toBeInTheDocument()
  })

  it('renders age in CampMinder yy.mm format through displayCampMinderAge', () => {
    // kindred#2088: `String(child.age)` printed a raw float verbatim (or
    // truncated one on the backend). Both sites must go through the shared
    // helper summer already uses -- two-digit months, no leading-zero years.
    render(
      <FamilyCard
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah', age: 1.5, grade: 0 },
            { person_cm_id: 9002, display_name: 'Ava', age: 0.06, grade: 0 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Noah (1.50)')).toBeInTheDocument()
    expect(screen.getByText('Ava (0.06)')).toBeInTheDocument()
  })

  it('omits an age it does not have rather than inventing one', () => {
    render(
      <FamilyCard
        party={party({
          children: [{ person_cm_id: 9001, display_name: 'Noah', age: null, grade: null }],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText(/Noah/)).toBeInTheDocument()
    expect(screen.queryByText(/Noah \(0\)/)).not.toBeInTheDocument()
  })

  it('chips the housing needs the fit check judges', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true, needs_private_bathroom: true } })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Power')).toBeInTheDocument()
    expect(screen.getByText('Private bathroom')).toBeInTheDocument()
  })

  it('marks a mandatory accommodation, which outranks placement', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_accommodation: true, accommodation_is_mandatory: true } })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Accommodation required')).toBeInTheDocument()
  })

  it('marks a returning household', () => {
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    expect(screen.getByText('Returning')).toBeInTheDocument()
  })

  it('says the fit is unverified rather than judging against an unconfirmed cabin', () => {
    // `has_power: false` on an unconfirmed row means "nobody has said". 0 of
    // 93 units are confirmed today, so this is the normal verdict.
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ is_confirmed: false })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Fit not verified')).toBeInTheDocument()
  })

  it('says the cabin does not fit only once the cabin is confirmed', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ has_power: false })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('No power')).toBeInTheDocument()
  })

  it('marks the party that did not request sharing when it is in a flagged slot', () => {
    // Keyed off the RESOLVED verdict, not the registration gate: the gate is
    // superseded wherever the Family Camp form answered.
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'no_share',
            proximity: [],
            request_text: '',
            needs_resolution: false,
            eligibility: 'declined',
            eligibility_source: 'form',
            answers_conflict: false,
          },
        })}
        sharedSlot={true}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Did not request sharing')).toBeInTheDocument()
  })

  it('does not call a party out for declining when it has the room to itself', () => {
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'no_share',
            proximity: [],
            request_text: '',
            needs_resolution: false,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText('Declined sharing')).not.toBeInTheDocument()
  })

  it('shows a share request as one chip covering both `with` and `similar_ages`', () => {
    // `similar_ages` ACCOMPANIES `with`; a chip showing one or the other drops
    // 22 households out of any "wants to share" view.
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'yes_share',
            proximity: ['with', 'similar_ages'],
            request_text: '',
            needs_resolution: false,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Wants to share')).toBeInTheDocument()
  })

  it('shows a similar-ages request even without an explicit `with`', () => {
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'yes_share',
            proximity: ['similar_ages'],
            request_text: '',
            needs_resolution: false,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Wants to share')).toBeInTheDocument()
  })
})

describe('FamilyCard — spec §3.8, what must stay off it', () => {
  it('never prints request text on the card', () => {
    // THE regression guard. 12 of 232 request texts carry health vocabulary
    // including a named diagnosis; the roster's accepted exposure was one row
    // at a time, not 62 cards at once. It lives on the detail panel.
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'yes_share',
            proximity: ['with'],
            request_text: REQUEST_TEXT,
            needs_resolution: true,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText(REQUEST_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp('ground-floor'))).not.toBeInTheDocument()
  })

  it('never offers a medical affordance', () => {
    // This used to be driven by `has_medical_narrative`, deleted in
    // kindred#1889 for being true for 62 of 62 parties. The card was already
    // right to ignore it; the assertion outlives the flag because the
    // narrative belongs on FamilyDetailsPanel, one household at a time.
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.queryByText(/Medical/i)).not.toBeInTheDocument()
  })

  it('never shows `needs_resolution`, which is true for 44 of 62', () => {
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'yes_share',
            proximity: [],
            request_text: '',
            needs_resolution: true,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText(/Needs resolution/i)).not.toBeInTheDocument()
  })
})

describe('FamilyCard — opening the detail panel', () => {
  it('calls back with the party when clicked', async () => {
    const onOpen = vi.fn()
    render(<FamilyCard party={party()} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is a real button, so it is reachable by keyboard', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Johnson/ })).toBeInTheDocument()
  })
})

describe('FamilyCardPreview — the drag overlay', () => {
  // WHY A SEPARATE COMPONENT EXISTS AT ALL. dnd-kit's `useDraggable`
  // registers its node UNCONDITIONALLY — `disabled` only nulls the listeners
  // (verified in @dnd-kit/core 6.3.1). So rendering a real `FamilyCard` inside
  // `<DragOverlay>` registers a SECOND draggable under the same `partyKey`,
  // overwrites the source card's registry entry, and then deletes it outright
  // when the overlay unmounts — leaving the card the staff member just dropped
  // absent from `draggableNodes`, with its own effect never re-firing.
  //
  // Summer hit this first and hand-rolls plain markup in its own DragOverlay
  // (`BunkingBoardByArea.tsx:662-702`) for exactly this reason. This is that
  // precedent, shared rather than duplicated so the two cannot drift.
  it('renders the family without registering a draggable', () => {
    const { container } = render(<FamilyCardPreview party={party()} />)
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Johnson')
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull()
  })

  it('is not a button, so it cannot steal the click target', () => {
    render(<FamilyCardPreview party={party()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the same children and ages the real card does', () => {
    // It is the card being dragged, so it has to LOOK like the card. Sharing
    // the body is what keeps that true without a second copy to maintain.
    render(<FamilyCardPreview party={party()} />)
    expect(screen.getByText(/Noah Johnson \(8\.00\)/)).toBeInTheDocument()
  })
})

/*
 * The occupant card's own scale, which is NOT the unit card's.
 *
 * Summer's `CamperCard` sits inside a `BunkCard` and steps down from it:
 * `text-sm` name over `text-xs` secondary, where the bunk title above is
 * `text-lg`. So a `FamilyCard` inside a `LodgingUnitCard` steps down the same
 * way — it does not inherit the unit card's body size, or the household name
 * would print as large as the room name holding it.
 *
 * Classes, not computed style: jsdom parses no Tailwind.
 */
describe('FamilyCard — summer’s occupant-card geometry', () => {
  /*
   * `CamperCard` is `rounded-xl border-2 p-2.5`. This card was `rounded-lg`,
   * a 1px border and `px-2 py-1.5` -- which read as a table row sitting inside
   * a card, the same criticism that started this exercise, one level down.
   *
   * `overflow-hidden` is deliberately NOT copied. `CamperCard` needs it to
   * clip an absolutely-positioned gradient at its foot; this card has no such
   * element, so the class would be cargo.
   */
  it('wears CamperCard’s radius, border and padding', () => {
    const { container } = render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    const card = container.querySelector('[data-family-card]')
    expect(card).toHaveClass('rounded-xl')
    expect(card).toHaveClass('border-2')
    expect(card).toHaveClass('p-2.5')
  })

  it('drops the row-shaped chrome it replaces', () => {
    // Left alongside the new classes these fight them: `rounded-lg` loses the
    // corner, and `px-2 py-1.5` beats `p-2.5` on the axes it sets.
    const { container } = render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    const card = container.querySelector('[data-family-card]')
    expect(card).not.toHaveClass('rounded-lg')
    expect(card).not.toHaveClass('px-2')
    expect(card).not.toHaveClass('py-1.5')
  })

  it('carries the same geometry into the drag overlay', () => {
    /*
     * Shared frame, so this passes for free -- and fails the moment somebody
     * hand-rolls a second one.
     *
     * The overlay is a plain `div` and carries no `data-family-card`: it must
     * not call `useDraggable`, and marking it as a card invites a future
     * selector to treat it as one. Assert on the rendered root instead.
     */
    const { container } = render(<FamilyCardPreview party={party()} />)
    const overlay = container.firstElementChild
    expect(overlay).toHaveClass('rounded-xl')
    expect(overlay).toHaveClass('border-2')
    expect(overlay).toHaveClass('p-2.5')
  })
})

describe('FamilyCard — summer’s type scale', () => {
  function arbitraryTextSizes(container: HTMLElement): string[] {
    const card = container.querySelector('[data-family-card]')
    if (!card) throw new Error('no card rendered')
    return [card, ...card.querySelectorAll('*')]
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => /^text-\[\d+px\]$/.test(cls))
  }

  it('uses the stock scale everywhere, with no arbitrary pixel sizes left', () => {
    const { container } = render(
      <FamilyCard
        party={party({
          is_returning: true,
          flags: { needs_private_bathroom: true, needs_power: true },
          share: { proximity: ['with', 'near'], eligibility: 'named', answers_conflict: true },
        })}
        unit={confirmedUnit()}
        sharedSlot
        onOpen={vi.fn()}
      />
    )
    expect(arbitraryTextSizes(container)).toEqual([])
  })

  it('names the household at summer’s CamperCard name size', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByTestId('family-card-name')).toHaveClass('text-sm')
  })

  it('sets the children line one step below the name, as summer does', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    // Each child gets its own `<span>`, so walk up one to the line that holds
    // them all — asserting on the inner span would pin nothing, since the size
    // is set on the line.
    const line = screen.getByText(/Noah Johnson \(8\.00\)/).parentElement
    expect(line).toHaveTextContent('Ava Johnson (5.00)')
    expect(line).toHaveClass('text-xs')
  })

  it('sets chips at summer’s meta size', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Power')).toHaveClass('text-xs')
  })

  it('carries the same scale into the drag overlay', () => {
    // The overlay shares `FamilyCardBody`, so this passes for free — which is
    // the point. It fails the moment somebody hand-rolls a second body.
    render(<FamilyCardPreview party={party()} />)
    expect(screen.getByTestId('family-card-name')).toHaveClass('text-sm')
  })
})
