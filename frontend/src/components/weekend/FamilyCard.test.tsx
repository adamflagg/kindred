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
    allocation_default: 'family_pool',
    reservation_state: null,
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

  it('never offers the medical affordance, which is true for 62 of 62 parties', () => {
    render(
      <FamilyCard party={party({ flags: { has_medical_narrative: true } })} onOpen={vi.fn()} />
    )
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
    expect(screen.getByText(/Noah Johnson \(8\)/)).toBeInTheDocument()
  })
})
