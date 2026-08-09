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
  // kindred#2152: the badge used to render the server's raw `party_size`,
  // which became a BED count under kindred#1925/#2046 (it drops
  // blank/placeholder adult slots and discounts an under-18-month infant) and
  // can legitimately disagree with the names actually printed on the card.
  // The default fixture's `party_size: 4` deliberately overstates its one
  // named adult + two named children (3) -- the badge must show the count
  // that agrees with what's printed below it, not the raw report.
  it('shows the count of adults and children actually printed, not the raw party_size', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('4')).not.toBeInTheDocument()
  })

  // kindred#1946's nameless-row cleanup runs on the next successful derived
  // sync, not on merge -- prod still carries rows like these today, so the
  // badge must already be correct with them present.
  it('excludes blank and placeholder adult rows from the badge even though party_size still counts them', () => {
    render(
      <FamilyCard
        party={party({
          party_size: 5,
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: '', relationship: '' },
            { adult_number: 3, display_name: 'NA', relationship: '' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    // 1 named adult + 2 named children = 3, not the reported 5.
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows children with ages, which is the entire point of a similar-ages match', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByText(/Noah/)).toBeInTheDocument()
    expect(screen.getByText(/8/)).toBeInTheDocument()
    expect(screen.getByText(/Ava/)).toBeInTheDocument()
    expect(screen.getByText(/5/)).toBeInTheDocument()
  })

  it('truncates the child’s age to whole years, never rounding up', () => {
    // kindred#2074: `persons.age` is CampMinder's yy.mm; months never exceed
    // .11, so a child of 6.11 -- six years, eleven months -- is six, not
    // seven. The card truncates; only the detail panel keeps `(Y)Y.MM`.
    render(
      <FamilyCard
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah', age: 6.11, grade: 0 },
            { person_cm_id: 9002, display_name: 'Ava', age: 0.06, grade: 0 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Noah (6)')).toBeInTheDocument()
    expect(screen.getByText('Ava (0)')).toBeInTheDocument()
    expect(screen.queryByText(/Noah \(7\)/)).not.toBeInTheDocument()
  })

  it('shows the attending adults on the grey line beneath the children', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'Liam Johnson', relationship: 'Father' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    // The surname they share is printed once at the end of the line rather
    // than on each name (kindred#2180) -- so this asserts on the LINE, not on
    // a per-adult span that no longer holds a whole name.
    expect(screen.getByTestId('family-card-adults')).toHaveTextContent('Emma · Liam Johnson')
  })

  it('drops blank adult slots -- family_camp_adults is not a fixed five', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: '', relationship: '' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    const adultsLine = screen.getByText(/Emma Johnson/).parentElement
    expect(adultsLine).toHaveTextContent('Emma Johnson')
    expect(adultsLine).not.toHaveTextContent('·')
  })

  it('removes the household salutation from the card entirely', () => {
    // kindred#2074: display_name is CampMinder's mailing_title, which
    // disagrees with the actual adult list on 26.7% of 2026 households.
    // Deletion, not a demotion to the grey line -- the grey line is adults.
    render(<FamilyCard party={party({ display_name: 'Mr. and Mrs. Johnson' })} onOpen={vi.fn()} />)
    expect(screen.queryByText('Mr. and Mrs. Johnson')).not.toBeInTheDocument()
  })

  it('keeps the guest’s own name for an adult weekend party (person grain)', () => {
    // Person-grain parties are one guest, not a household -- there is no
    // untrustworthy salutation to remove, so the identity line is unchanged.
    render(
      <FamilyCard
        party={party({
          grain: 'person',
          display_name: 'Priya Patel',
          children: [],
          adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Priya Patel')
  })

  it('falls back rather than leaving a blank identity line for a nameless child', () => {
    // `_person_display_name` (unlike `_household_display_name`) has no
    // fallback and returns '' when a synced person has no preferred_name,
    // first_name, or last_name on file. Before the salutation was removed
    // this was invisible -- the bold line came from `display_name`, never
    // from a child's own name. Now it is the ONLY source for a household
    // card, so a blank name must not leave the button with no accessible
    // text at all.
    render(
      <FamilyCard
        party={party({
          children: [{ person_cm_id: 9001, display_name: '', age: 6, grade: 1 }],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Unnamed camper (6)')
  })

  it('renders a person-grain party’s own children, with CampMinder precision, not truncated', () => {
    // Person-grain (adult weekend) parties don't carry children under
    // today's sync (`_build_person_parties` never sets the field), but the
    // grey line's fallback for the rare case it does is real code, not dead
    // weight -- it should render, and keep the full (Y)Y.MM the household
    // branch above deliberately does NOT use.
    render(
      <FamilyCard
        party={party({
          grain: 'person',
          display_name: 'Priya Patel',
          adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
          children: [{ person_cm_id: 9001, display_name: 'Kai Patel', age: 6.11, grade: 1 }],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Kai Patel (6.11)')).toBeInTheDocument()
  })

  it('falls back for a nameless child on the person-grain grey line too', () => {
    // The two child lists share one renderer (kindred#2153), so the blank-name
    // fallback pinned above for the household bold line must hold here as
    // well. Pinned separately because a shared renderer is exactly the thing a
    // later session could re-split, and this branch would go quiet first.
    render(
      <FamilyCard
        party={party({
          grain: 'person',
          display_name: 'Priya Patel',
          adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
          children: [{ person_cm_id: 9001, display_name: '', age: 6.11, grade: 1 }],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Unnamed camper (6.11)')).toBeInTheDocument()
  })

  it('separates multiple children with a middot on both child lines', () => {
    // The separator is the one piece of the child list with no other test
    // holding it, and it is shared by both lines.
    const { unmount } = render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByTestId('family-card-name')).toHaveTextContent(
      'Noah Johnson (8) · Ava Johnson (5)'
    )
    unmount()

    render(
      <FamilyCard
        party={party({
          grain: 'person',
          display_name: 'Priya Patel',
          adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
          children: [
            { person_cm_id: 9001, display_name: 'Kai Patel', age: 6.11, grade: 1 },
            { person_cm_id: 9002, display_name: 'Mia Patel', age: 4.02, grade: 0 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Kai Patel (6.11)').parentElement).toHaveTextContent(
      'Kai Patel (6.11) · Mia Patel (4.02)'
    )
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

  it('marks a first-time household when is_returning is false', () => {
    render(<FamilyCard party={party({ is_returning: false })} onOpen={vi.fn()} />)
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  it('marks a first-time household when is_returning is undefined', () => {
    const p = party()
    delete p.is_returning
    render(<FamilyCard party={p as RosterPartyRow} onOpen={vi.fn()} />)
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  // Adult weekend guests are `grain: 'person'`. The API never computes
  // `is_returning` for that grain (`_build_person_parties` omits the field
  // entirely, so Pydantic's `bool = False` default fills the wire value) --
  // it is not "false", it is "not tracked". Showing "First-time" here would
  // brand every adult weekend regular a newcomer on every visit.
  it('stays silent on returning status for an adult weekend guest (person grain)', () => {
    render(<FamilyCard party={party({ grain: 'person', is_returning: false })} onOpen={vi.fn()} />)
    expect(screen.queryByText('First-time')).not.toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  it('says the fit is unverified rather than judging against an unconfirmed cabin', () => {
    // `has_power: false` on an UNCONFIRMED row means "nobody has said", which
    // is what this fixture pins. It used to add "0 of 93 units are confirmed
    // today, so this is the normal verdict" — production is 118/118 confirmed
    // as of 2026-08-09, so this is now the exception branch, not the norm.
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

  it('says which two answers disagreed, and that the form wins, on the "Answers disagree" chip (kindred#2083)', () => {
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'no_share',
            proximity: [],
            request_text: '',
            needs_resolution: false,
            eligibility: 'open',
            eligibility_source: 'form',
            answers_conflict: true,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    const chip = screen.getByText('Answers disagree')
    expect(chip).toHaveAttribute('title', expect.stringContaining('will not share'))
    expect(chip).toHaveAttribute('title', expect.stringContaining('open to sharing'))
    expect(chip).toHaveAttribute('title', expect.stringContaining("form's answer"))
  })

  it('renders no "Answers disagree" chip, and no tooltip, when there is no conflict', () => {
    render(
      <FamilyCard
        party={party({
          share: {
            preference: 'yes_share',
            proximity: ['with'],
            request_text: '',
            needs_resolution: false,
            eligibility: 'open',
            eligibility_source: 'form',
            answers_conflict: false,
          },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText('Answers disagree')).not.toBeInTheDocument()
  })

  it('never shows "Answers disagree" for an adult weekend guest — there is no share question to disagree on', () => {
    // person-grain parties carry no share block at all
    // (`_build_person_parties` attaches none), so there is nothing here to
    // report — not an empty chip.
    render(<FamilyCard party={party({ grain: 'person' })} onOpen={vi.fn()} />)
    expect(screen.queryByText('Answers disagree')).not.toBeInTheDocument()
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

  it('marks a placement that holds a whole building — #2008', () => {
    render(<FamilyCard party={party()} holdsWholeBuilding={true} onOpen={vi.fn()} />)
    expect(screen.getByText('Whole building')).toBeInTheDocument()
  })

  it('says nothing about a placement that does not hold a whole building', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
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

  it('shows the same children and truncated ages the real card does', () => {
    // It is the card being dragged, so it has to LOOK like the card. Sharing
    // the body is what keeps that true without a second copy to maintain.
    render(<FamilyCardPreview party={party()} />)
    expect(screen.getByText(/Noah Johnson \(8\)/)).toBeInTheDocument()
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

  it('sets the card’s bold identity line at summer’s CamperCard name size', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByTestId('family-card-name')).toHaveClass('text-sm')
  })

  it('sets the adults line one step below the children, as summer steps its secondary line', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'Liam Johnson', relationship: 'Father' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    // Each adult gets its own `<span>`, so the size is asserted on the LINE
    // that holds them all — an inner span would pin nothing.
    const line = screen.getByTestId('family-card-adults')
    expect(line).toHaveTextContent('Emma · Liam Johnson')
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

/**
 * kindred#2180 — a shared surname is printed once, at the end of the line.
 *
 * The children's half runs off the structured `last_name` the API now sends
 * (a surname containing a space is 4.7% of 2026's rostered children, and a
 * hyphenated one is 10.6%); the adults' half has no such column and can only
 * compare the trailing token of a free-text name, so it fires on 39.7% of
 * multi-adult households and leaves the rest alone.
 */
describe('FamilyCard — a shared surname is not repeated', () => {
  it('prints the children’s shared surname once, after the run', () => {
    render(
      <FamilyCard
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8 },
            { person_cm_id: 9002, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Noah (8) · Ava (5) Johnson')
  })

  // ⚠️ A hyphenated surname is ONE name. 72 of 2026's 680 distinct rostered
  // children carry one; splitting on the hyphen would name them "The Garcia
  // & Lopez Family" and print half a surname on the card.
  it('treats a hyphenated surname as one name', () => {
    render(
      <FamilyCard
        party={party({
          children: [
            {
              person_cm_id: 9001,
              display_name: 'Noah Garcia-Lopez',
              last_name: 'Garcia-Lopez',
              age: 8,
            },
            {
              person_cm_id: 9002,
              display_name: 'Ava Garcia-Lopez',
              last_name: 'Garcia-Lopez',
              age: 5,
            },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent(
      'Noah (8) · Ava (5) Garcia-Lopez'
    )
  })

  // The reason `last_name` had to go on the wire: the trailing token of
  // `display_name` would have left "Martinez" on both children and printed
  // "Garcia" as the shared surname.
  it('lifts a surname that contains a space whole', () => {
    render(
      <FamilyCard
        party={party({
          children: [
            {
              person_cm_id: 9001,
              display_name: 'Noah Martinez Garcia',
              last_name: 'Martinez Garcia',
              age: 8,
            },
            {
              person_cm_id: 9002,
              display_name: 'Ava Martinez Garcia',
              last_name: 'Martinez Garcia',
              age: 5,
            },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent(
      'Noah (8) · Ava (5) Martinez Garcia'
    )
  })

  it('leaves two different surnames written out in full', () => {
    render(
      <FamilyCard
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8 },
            { person_cm_id: 9002, display_name: 'Ava Garcia', last_name: 'Garcia', age: 5 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent(
      'Noah Johnson (8) · Ava Garcia (5)'
    )
  })

  it('leaves an only child their whole name', () => {
    render(
      <FamilyCard
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8 },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Noah Johnson (8)')
  })

  it('prints the adults’ shared surname once, after their line', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-adults')).toHaveTextContent('Emma · David Johnson')
  })

  it('leaves adults with different surnames written out in full', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'David Garcia', relationship: 'Father' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-adults')).toHaveTextContent(
      'Emma Johnson · David Garcia'
    )
  })

  // A placeholder slot has no trailing token to share, so it must be gone
  // BEFORE the comparison -- otherwise one "NA" row suppresses the dedupe on
  // every card that has one.
  it('dedupes past a placeholder adult slot', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
            { adult_number: 3, display_name: 'NA', relationship: '' },
          ],
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('family-card-adults')).toHaveTextContent('Emma · David Johnson')
  })
})
