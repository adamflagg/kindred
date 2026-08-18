/**
 * The family card is the board's atom — a household of mixed ages, not a
 * camper.
 *
 * The load-bearing tests here are the ABSENCES. Spec §3.8 keeps three things
 * off the card, each for a measured reason, and each is the kind of thing a
 * later session would helpfully add back:
 *
 *   - request text: 12 of 232 contain health vocabulary including a named
 *     diagnosis, and the roster's medical-narrative exposure was accepted for
 *     opening ONE row at a time, not for printing it across 62 cards at once;
 *   - the medical affordance: true for 62 of 62 parties;
 *   - `needs_resolution`: true for 44 of 62.
 *
 * A flag that is always on is not a flag.
 *
 * Fictional data throughout.
 */
import { DndContext } from '@dnd-kit/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyCard, FamilyCardPreview } from './FamilyCard'

// Mirrors `LodgingBoard.drag.test.tsx`'s idiom: jsdom cannot perform a real
// pointer drag, and `DndContext`'s sensor setup is irrelevant to what this
// file checks (whether dnd-kit's ATTRIBUTES land on the right element, not
// whether a drag completes), so `DndContext` is replaced with a pass-through.
// `useDraggable` itself stays real — its `attributes` computation does not
// read this context at all (verified against @dnd-kit/core 6.3.1's source:
// `role`/`tabIndex` are hard-coded, not context-derived), so this exists only
// to render the same tree the real board renders, not to make the
// assertions below possible.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

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
    // holding it, and it is shared by both lines. Order is youngest-first
    // (kindred#2254), so the default fixture's Noah(8)/Ava(5) prints Ava
    // before Noah — see the dedicated ordering tests below for that half.
    const { unmount } = render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.getByTestId('family-card-name')).toHaveTextContent(
      'Ava Johnson (5) · Noah Johnson (8)'
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
    expect(screen.getByText('Mia Patel (4.02)').parentElement).toHaveTextContent(
      'Mia Patel (4.02) · Kai Patel (6.11)'
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

  describe('children order is youngest-first (kindred#2254)', () => {
    it('orders three children youngest to oldest on the bold identity line', () => {
      render(
        <FamilyCard
          party={party({
            children: [
              { person_cm_id: 9001, display_name: 'Noah', age: 8, grade: 3 },
              { person_cm_id: 9002, display_name: 'Ava', age: 5, grade: 0 },
              { person_cm_id: 9003, display_name: 'Mia', age: 2, grade: null },
            ],
          })}
          onOpen={vi.fn()}
        />
      )
      expect(screen.getByTestId('family-card-name')).toHaveTextContent(
        'Mia (2) · Ava (5) · Noah (8)'
      )
    })

    it('trails an unknown-age child rather than sorting it first', () => {
      // `age: null` is this field's already-converted unknown-age sentinel
      // (the API collapses the raw `0.0` -- kindred#2088 -- before it ever
      // reaches the wire). A comparator naive enough to do
      // `(a.age ?? 0) - (b.age ?? 0)` would treat that null as "age 0" and
      // sort it FIRST under an ascending youngest-first order -- the exact
      // opposite of the intent, and wrong in a way that looks right. It
      // belongs in its own bucket at the end instead.
      render(
        <FamilyCard
          party={party({
            children: [
              { person_cm_id: 9001, display_name: 'Noah', age: 8, grade: 3 },
              { person_cm_id: 9002, display_name: 'NoBirthdate', age: null, grade: null },
              { person_cm_id: 9003, display_name: 'Ava', age: 5, grade: 0 },
            ],
          })}
          onOpen={vi.fn()}
        />
      )
      expect(screen.getByTestId('family-card-name')).toHaveTextContent(
        'Ava (5) · Noah (8) · NoBirthdate'
      )
    })

    it('never mutates the children array the API sent — other surfaces read the same reference', () => {
      const children = [
        { person_cm_id: 9001, display_name: 'Noah', age: 8, grade: 3 },
        { person_cm_id: 9002, display_name: 'Ava', age: 5, grade: 0 },
      ]
      render(<FamilyCard party={party({ children })} onOpen={vi.fn()} />)
      // Still oldest-first, exactly as passed in — a display-only reorder
      // must produce its own copy, never `Array.prototype.sort` in place.
      expect(children.map((c) => c.person_cm_id)).toEqual([9001, 9002])
    })
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
    // No `as RosterPartyRow` here: `is_returning` is optional on the row, so
    // `delete` leaves `p` at its declared type and the assertion only hid
    // that from the reader (`@typescript-eslint/no-unnecessary-type-assertion`).
    render(<FamilyCard party={p} onOpen={vi.fn()} />)
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

  it('says which two answers disagreed, and that the form wins, on the "Answers disagree" chip\'s tooltip (kindred#2250)', () => {
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
    // kindred#2250: the detail is now a real, keyboard- and touch-reachable
    // `ui/Tooltip` trigger, not the `sr-only` text kindred#2177 shipped as a
    // stopgap while the card's outer `<button>` still forbade a nested
    // interactive descendant (kindred#2222 lifted that wall; this chip is
    // what actually uses the opening).
    const chip = screen.getByText('Answers disagree').closest('button')
    expect(chip).not.toBeNull()
    expect(chip).not.toHaveAttribute('title')
    // Closed by default — the detail sentence is not sitting on the page
    // until a staff member actually summons it.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(chip as HTMLElement)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(/will not share/)
    expect(tooltip).toHaveTextContent(/open to sharing/)
    expect(tooltip).toHaveTextContent(/form's answer/)
    // Still a SIBLING of the card's own open control, never nested inside
    // it (kindred#2222) — a nested interactive trigger would be invalid
    // HTML and its tap would bubble into `onOpen` instead of the bubble.
    expect(screen.getByRole('button', { name: /Johnson/ })).not.toContainElement(chip)
  })

  it('never nests an interactive control inside another one — checked by ROLE, not TAG (kindred#2222)', () => {
    // The guard behind the chip's `sr-only` detail (kindred#2177), re-keyed
    // for kindred#2222. The original version of this guard matched on the
    // TAG (`button button`), which a `<div>` frame defeats trivially even
    // when it is STILL an ARIA button: `useDraggable`'s `attributes` carries
    // `role: 'button'` + `tabIndex: 0` UNCONDITIONALLY, so a naive tag swap
    // that still spreads them onto the frame recreates
    // `<div role="button" tabindex="0">` — which assistive tech, and the
    // HTML content model, still treat as a button. A tag-based selector
    // cannot see that; a role-based one can, because `getAllByRole('button')`
    // resolves the computed ACCESSIBLE role (explicit `role="button"` as well
    // as a native `<button>` tag), not the literal tag name.
    const { container } = render(
      <FamilyCard
        party={party({
          share: {
            preference: 'no_share',
            proximity: ['with'],
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
    expect(screen.getByText('Wants to share')).toBeInTheDocument()
    const roleButtons = within(container).getAllByRole('button')
    expect(roleButtons.length).toBeGreaterThan(0)
    for (const outer of roleButtons) {
      const nested = roleButtons.filter((el) => el !== outer && outer.contains(el))
      expect(nested).toHaveLength(0)
      // Catches a focusable-but-not-role="button" descendant too — e.g. an
      // element some future edit makes tabbable without giving it a role.
      expect(outer.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0)
    }
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

  describe('single-parent flag (kindred#2254 half 2)', () => {
    // #2072's own scoping ruling replaces only the two need chips
    // (`Private bathroom`/`Power`) with the glyph gutter — `Whole building`,
    // the warn chips and the share chips, including this one, stay as
    // words. So this reuses the muted `Near another family` chip's exact
    // grammar rather than inventing a new visual channel, and does not wait
    // on #2072.
    it('flags a household with exactly one attending adult', () => {
      // The default fixture already has one adult (`Emma Johnson`).
      render(<FamilyCard party={party()} onOpen={vi.fn()} />)
      expect(screen.getByText('Single parent')).toBeInTheDocument()
    })

    it('matches the muted "Near another family" chip\'s classes exactly — no new tone invented', () => {
      render(
        <FamilyCard
          party={party({
            share: {
              preference: 'yes_share',
              proximity: ['near'],
              request_text: '',
              needs_resolution: false,
            },
          })}
          onOpen={vi.fn()}
        />
      )
      const singleParentChip = screen.getByText('Single parent')
      const nearChip = screen.getByText('Near another family')
      expect(singleParentChip.className).toBe(nearChip.className)
    })

    it('says nothing when two adults are attending', () => {
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
      expect(screen.queryByText('Single parent')).not.toBeInTheDocument()
    })

    // A placeholder slot ("NA", "-", ...) is not an attending adult
    // (`isAttendingAdultName`, kindred#1925) — a household with ONE real
    // adult and four placeholder slots is still one attending adult, and a
    // household with ZERO real adults is a data gap, not a single parent.
    it('does not count a placeholder slot as a second parent', () => {
      render(
        <FamilyCard
          party={party({
            adults: [
              { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
              { adult_number: 2, display_name: 'NA', relationship: '' },
            ],
          })}
          onOpen={vi.fn()}
        />
      )
      expect(screen.getByText('Single parent')).toBeInTheDocument()
    })

    it('says nothing when no adult is named at all — a data gap, not a single parent', () => {
      render(<FamilyCard party={party({ adults: [] })} onOpen={vi.fn()} />)
      expect(screen.queryByText('Single parent')).not.toBeInTheDocument()
    })

    // Person-grain parties (adult weekend guests) ARE their own identity —
    // there is no separate "attending adults" list to be short one of.
    // `attendingAdults` already returns `[]` for this grain, so the
    // household-composition question does not apply.
    it('never flags an adult weekend guest (person grain) as a single parent', () => {
      render(
        <FamilyCard
          party={party({
            grain: 'person',
            display_name: 'Priya Patel',
            adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
            children: [],
          })}
          onOpen={vi.fn()}
        />
      )
      expect(screen.queryByText('Single parent')).not.toBeInTheDocument()
    })
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

describe('FamilyCard — draggable state does not recreate an ARIA button on the frame (kindred#2222 residual)', () => {
  // The guard at "never nests an interactive control..." above never actually
  // exercises `isDraggable={true}` — every render in this file up to here
  // leaves it at its `false` default, so `useDraggable`'s conditional spread
  // (`{...(isDraggable ? attributes : {})}`) always evaluates to `{}`
  // regardless of which element it's spread onto. That means the ACTUAL
  // regression this file exists to guard against — dnd-kit's `attributes`
  // (which carry `role: 'button'` + `tabIndex: 0` unconditionally, per
  // `useDraggable`'s own doc) landing back on the outer frame — has never
  // been reachable by any assertion here. This is the one render that
  // reaches it.
  it('keeps dnd-kit’s attributes off the frame when the card is actually draggable', () => {
    const { container } = render(
      <DndContext>
        <FamilyCard party={party()} isDraggable={true} onOpen={vi.fn()} />
      </DndContext>
    )
    const frame = container.querySelector('[data-family-card]')
    expect(frame).not.toBeNull()
    // The frame legitimately carries dnd-kit's LISTENERS while draggable (so
    // a drag can start from anywhere on the card) -- it must not also carry
    // dnd-kit's ATTRIBUTES. Those are two different halves of what
    // `useDraggable` returns, and only one belongs on this element.
    expect(frame).not.toHaveAttribute('role')
    expect(frame).not.toHaveAttribute('tabindex')
    // Exactly the inner control(s) are real buttons -- the frame itself
    // never joins that count, draggable or not.
    const roleButtons = within(container).getAllByRole('button')
    expect(roleButtons).toHaveLength(1)
    expect(roleButtons[0]).toBe(frame?.querySelector('button'))
  })

  it('would still catch a bare tabIndex left on the frame even without a role', () => {
    // The role-keyed guard above only walks INSIDE each `getAllByRole
    // ('button')` match -- `outer.querySelectorAll('[tabindex]...')`. A
    // `tabIndex` added directly to the FRAME, which never carries a
    // "button" role itself, sits outside every button's subtree and is
    // invisible to that loop no matter how draggable the card is. Scanning
    // the whole container instead is what catches it: every element that is
    // actually in the tab order must be one of the accessible buttons, full
    // stop -- not "every button's descendants are clean".
    const { container } = render(
      <DndContext>
        <FamilyCard party={party()} isDraggable={true} onOpen={vi.fn()} />
      </DndContext>
    )
    const tabbable = Array.from(container.querySelectorAll('[tabindex]:not([tabindex="-1"])'))
    const roleButtons = within(container).getAllByRole('button')
    for (const el of tabbable) {
      expect(roleButtons).toContain(el)
    }
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
    // The overlay shares `FamilyCardIdentity`/`FamilyCardChips`, so this
    // passes for free — which is the point. It fails the moment somebody
    // hand-rolls a second body.
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
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Ava (5) · Noah (8) Johnson')
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
      'Ava (5) · Noah (8) Garcia-Lopez'
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
      'Ava (5) · Noah (8) Martinez Garcia'
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
      'Ava Garcia (5) · Noah Johnson (8)'
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

/**
 * kindred#2075 — last year's housing, right-anchored on the EXISTING grey line.
 *
 * Ruled Option A: mirror what summer already ships. `CamperCard.tsx` renders
 * its `historyDisplay` right-anchored on line 2 beside Age/Grade; this puts
 * the prior-year cabin right-anchored on line 2 beside the adults. NO THIRD
 * LINE — the card is already denser than the request was filed against.
 *
 * The density constraint is the interesting half. Summer's line 2 carries a
 * fixed-width "Age 9.42 · 4th"; this one carries variable-length adult names,
 * and the card is about 244 px wide inside `LodgingUnitCard` (its `p-4` +
 * `border-2` eat 36 px off the board's `minmax(280px,1fr)` column). So the two
 * genuinely compete, and the ruling settles which one gives: TRUNCATE THE
 * ADULT NAMES. The cabin string is the new information and must stay legible.
 */
describe('FamilyCard — last year’s housing', () => {
  it('right-anchors the prior-year cabin on the same grey line as the adults', () => {
    render(
      <FamilyCard
        party={party({ is_returning: true, last_year_cabin: 'Cedar Lodge - Room 2' })}
        onOpen={vi.fn()}
      />
    )
    const housing = screen.getByTestId('family-card-last-year-cabin')
    expect(housing).toHaveTextContent('Cedar Lodge - Room 2')
    // The SAME row as the adults, not a line of its own — the whole point of
    // the ruling is 0 px added to the card.
    expect(housing.parentElement).toContainElement(screen.getByTestId('family-card-adults'))
  })

  // THE COMMON CASE. 202 of 2026's 459 registered households have no 2025
  // cabin, and "" covers three different facts (first-timer, skipped a year,
  // last here before 2022 when `cabin_assignment` was blank on all 1,433
  // rows). None of them is "nobody assigned them", so none of them gets a
  // placeholder, an em dash, or a "First year" label.
  it('renders nothing at all when there is no prior-year cabin', () => {
    render(<FamilyCard party={party({ last_year_cabin: '' })} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('family-card-last-year-cabin')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.queryByText(/first year/i)).not.toBeInTheDocument()
  })

  // DIRECTLY PRIOR YEAR ONLY. A family placed two years ago but not last year
  // arrives with `is_returning: true` and an empty cabin — the two fields come
  // from different tables and the "Returning" badge must not tempt anything
  // here into showing an older stay.
  it('shows nothing for a returning family whose last stay was not last year', () => {
    render(
      <FamilyCard party={party({ is_returning: true, last_year_cabin: '' })} onOpen={vi.fn()} />
    )
    expect(screen.getByText('Returning')).toBeInTheDocument()
    expect(screen.queryByTestId('family-card-last-year-cabin')).not.toBeInTheDocument()
  })

  it('truncates the adult names and never the cabin', () => {
    render(
      <FamilyCard
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Genevieve Aleksandrova', relationship: 'Mother' },
            { adult_number: 2, display_name: 'Bartholomew Aleksandrov', relationship: 'Father' },
          ],
          last_year_cabin: 'Cedar Grove Lodge - Room 12B',
        })}
        onOpen={vi.fn()}
      />
    )
    const adults = screen.getByTestId('family-card-adults')
    const housing = screen.getByTestId('family-card-last-year-cabin')
    // The adults give way: `min-w-0` is what lets a flex child shrink below
    // its content width at all, and without it `truncate` never fires.
    expect(adults).toHaveClass('min-w-0', 'flex-1', 'truncate')
    // The cabin does not: it neither shrinks nor wraps nor clips.
    expect(housing).toHaveClass('whitespace-nowrap')
    expect(housing).not.toHaveClass('truncate')
    expect(housing).toHaveTextContent('Cedar Grove Lodge - Room 12B')
  })

  // A household with no attending adult has no grey line for the cabin to
  // join (kindred#1925/#1946 dropped the nameless rows). The cabin is real
  // data and is not dropped to preserve a line that was never there.
  //
  // RARE, and do not re-derive it from `family_camp_adults.name` alone: 63 of
  // 2026's 459 registered households have that column blank, but
  // `_adult_display_name`'s first_name/last_name fallback is load-bearing, so
  // the figure `computeAttendingAdults` produces is 35 of 459 registered and
  // ONE of the 382 rostered households the board renders.
  it('still shows the cabin for a household with no attending adults', () => {
    render(
      <FamilyCard party={party({ adults: [], last_year_cabin: 'Pine Cabin' })} onOpen={vi.fn()} />
    )
    expect(screen.getByTestId('family-card-last-year-cabin')).toHaveTextContent('Pine Cabin')
    expect(screen.queryByTestId('family-card-adults')).not.toBeInTheDocument()
  })

  // Same grain gate as the "Returning" badge, and for the same reason: the
  // server only ever keys this off a HOUSEHOLD cm_id, so a person-grain adult
  // weekend guest has no prior-year cabin to have. Rendering one would put a
  // line on a card that has no grey line at all.
  it('never renders on a person-grain adult weekend guest', () => {
    render(
      <FamilyCard
        party={party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 5001,
          display_name: 'Liam Garcia',
          adults: [],
          children: [],
          last_year_cabin: 'Pine Cabin',
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByTestId('family-card-last-year-cabin')).not.toBeInTheDocument()
  })

  it('carries the cabin into the drag overlay too', () => {
    render(<FamilyCardPreview party={party({ last_year_cabin: 'Pine Cabin' })} />)
    expect(screen.getByTestId('family-card-last-year-cabin')).toHaveTextContent('Pine Cabin')
  })
})
