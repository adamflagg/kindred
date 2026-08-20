/**
 * The family card is the board's atom — a household of mixed ages, not a
 * camper.
 *
 * The load-bearing tests here are the ABSENCES.
 * `docs/reference/weekend-card-vocabulary.md` §3 keeps three things off the
 * card, each for a measured reason, and each is the kind of thing a later
 * session would helpfully add back (the citation used to read "spec §3.8" and
 * pointed at a gitignored file — kindred#2072 moved the record somewhere
 * everyone can read):
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

/**
 * Which of the two history marks R3 drew, read off its tooltip.
 *
 * The mark is a 16px ICON with no text (kindred#2072), so `getByText`
 * cannot see it any more. The tooltip is the only place the word lives, and
 * reading it here rather than asserting on an icon class keeps these tests
 * about the FACT the card states.
 */
function historyMark(): string | null {
  const mark = screen.getByTestId('family-card-history')
  fireEvent.focus(mark)
  const label = screen.getByRole('tooltip').textContent
  fireEvent.blur(mark)
  return label
}

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

  // The two NEED chips this file used to assert here are glyphs now
  // (kindred#2072). The positive assertion lives in "the need glyphs"; their
  // absence as words is pinned in "the marks kindred#2072 STRUCK". Deleted
  // rather than softened — a test that still passed with either shape on the
  // card would defend neither.

  it('marks a mandatory accommodation, which outranks placement', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_accommodation: true, accommodation_is_mandatory: true } })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Needs Accommodation')).toBeInTheDocument()
  })

  it('marks a returning household', () => {
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    // R3: an icon, not the word. The tooltip carries the word, and
    // "Returning / First-time is a 20px icon" below pins the geometry.
    expect(historyMark()).toBe('Returning family')
  })

  it('marks a first-time household when is_returning is false', () => {
    render(<FamilyCard party={party({ is_returning: false })} onOpen={vi.fn()} />)
    expect(historyMark()).toBe('First-time family')
  })

  it('marks a first-time household when is_returning is undefined', () => {
    const p = party()
    delete p.is_returning
    // No `as RosterPartyRow` here: `is_returning` is optional on the row, so
    // `delete` leaves `p` at its declared type and the assertion only hid
    // that from the reader (`@typescript-eslint/no-unnecessary-type-assertion`).
    render(<FamilyCard party={p} onOpen={vi.fn()} />)
    expect(historyMark()).toBe('First-time family')
  })

  // Adult weekend guests are `grain: 'person'`. The API never computes
  // `is_returning` for that grain (`_build_person_parties` omits the field
  // entirely, so Pydantic's `bool = False` default fills the wire value) --
  // it is not "false", it is "not tracked". Showing "First-time" here would
  // brand every adult weekend regular a newcomer on every visit.
  it('stays silent on returning status for an adult weekend guest (person grain)', () => {
    render(<FamilyCard party={party({ grain: 'person', is_returning: false })} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('family-card-history')).not.toBeInTheDocument()
  })

  // The `unverified` ("Fit not verified") and `unmet` ("No power") chips are
  // both struck (vocabulary §3). The RULE behind them is untouched and still
  // tested — `rosterAttention.test.ts` owns the confirmed-cabin gate and the
  // per-need verdicts, which is where it always belonged; these two only ever
  // asserted that the card printed the result. Their negative pins are in
  // "the marks kindred#2072 STRUCK".

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

  describe('single-parent flag (kindred#2254 half 2)', () => {
    /*
     * ⚠️ THE COMMENT THAT USED TO SIT HERE IS SUPERSEDED, and is rewritten
     * rather than deleted because it recorded a real earlier scoping.
     *
     * It said #2072 replaced ONLY the two need chips, so this one "stays as
     * words" in the muted `Near another family` grammar and did not wait on
     * #2072. The 2026-08-19 rulings went further: S2 moves the mark off the
     * chip row entirely, onto line 2 before the adult it describes, and Sa
     * makes it AMBER — First-time's tone — precisely because borrowing the
     * sharing chips' grammar made a fact about who is in the room read as a
     * preference the household expressed.
     *
     * The geometry and the colour are pinned in "single parent is a mark on
     * line 2"; what stays here is the DERIVATION, which is unchanged and is
     * the half that had the bug.
     */
    it('flags a household with exactly one attending adult', () => {
      // The default fixture already has one adult (`Emma Johnson`).
      render(<FamilyCard party={party()} onOpen={vi.fn()} />)
      expect(screen.getByTestId('family-card-single-parent')).toBeInTheDocument()
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
      expect(screen.queryByTestId('family-card-single-parent')).not.toBeInTheDocument()
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
      expect(screen.getByTestId('family-card-single-parent')).toBeInTheDocument()
    })

    it('says nothing when no adult is named at all — a data gap, not a single parent', () => {
      render(<FamilyCard party={party({ adults: [] })} onOpen={vi.fn()} />)
      expect(screen.queryByTestId('family-card-single-parent')).not.toBeInTheDocument()
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
      expect(screen.queryByTestId('family-card-single-parent')).not.toBeInTheDocument()
    })
  })
})

describe('FamilyCard — weekend-card-vocabulary §3, what must stay off it', () => {
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
    // The FRAME never joins the button count, draggable or not — that is the
    // assertion, and it is why this no longer counts to exactly one. The chip
    // row legitimately holds tooltip triggers of its own since kindred#2072
    // (the need glyphs and R3's history mark), and they are SIBLINGS of the
    // card's control rather than descendants of the frame's role, which is
    // the property this guard exists to protect.
    const roleButtons = within(container).getAllByRole('button')
    expect(roleButtons).not.toContain(frame)
    // The first control in document order is still the card's own opener.
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

  it('carries no card-opening control, so it cannot steal the click target', () => {
    render(<FamilyCardPreview party={party()} />)
    // The identity lines are plain text in the overlay — the real card wraps
    // them in a `<button>` that calls `onOpen`, and the overlay has no
    // `onOpen` to call.
    expect(screen.getByTestId('family-card-name').closest('button')).toBeNull()
    // It DOES carry the chip row's own tooltip triggers, because it shares
    // `FamilyCardChips` rather than copying it — R3's history mark here. That
    // is the sharing working, not a leak: this used to assert "no button at
    // all", which only held while no chip had a tooltip.
    expect(screen.getAllByRole('button')).toEqual([screen.getByTestId('family-card-history')])
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
    // Retargeted off the struck `Power` NEED chip onto a surviving word chip
    // (kindred#2072). The size rule is unchanged; only the chip that carried
    // the assertion went.
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
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Near another family')).toHaveClass('text-xs')
  })

  it('sets the need glyph at the chip row’s own icon size, in a chip-height box', () => {
    // The glyph replaced a `text-xs` chip and has to sit on the same line as
    // the ones that remain, so its BOX matches their height: `h-5 w-5` is
    // 20px, the same as a word chip's 2px padding around 16px of line. It was
    // `p-0.5` — an 18px box against 20px chips, which reads as a misalignment
    // rather than as a smaller mark. The board-wide arbitrary-size sweep
    // covers `text-[Npx]` and would not see either, so both get a pin here.
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    const glyph = screen.getByTestId('need-glyph-power')
    expect(glyph.querySelector('svg')).toHaveClass('h-3', 'w-3')
    expect(glyph).toHaveClass('h-5', 'w-5')
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

  it('lifts an only child’s surname too, so the age follows the first name', () => {
    /*
     * ⚠️ REVERSED BY RULING (owner, 2026-08-20). This test used to assert
     * `Noah Johnson (8)`, on kindred#2180's "a single child shares nothing
     * with anybody". The lift's purpose on this board is to put the AGE next
     * to the first name — the pair staff read when they are matching families
     * by how old the children are — and a surname sits between them just as
     * much on a household with one child as on one with three. The rule moved
     * in `dedupeChildNames`, so the card, the details panel and the Assign
     * modal's candidate rows all moved together.
     */
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
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Noah (8) Johnson')
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

  /*
   * THE COMMON CASE. 202 of 2026's 459 registered households have no 2025
   * cabin, and "" covers three different facts (first-timer, skipped a year,
   * last here before 2022 when `cabin_assignment` was blank on all 1,433
   * rows). None of them is "nobody assigned them", so none of them gets a
   * placeholder, an em dash, or a "First year" label.
   *
   * ⚠️ THE REVIEW ARTIFACT DRAWS A DIMMED EM DASH HERE. This is one of the
   * few places the shipped card and that artifact deliberately differ, so the
   * pin below is what stops a later session "fixing" the card to match the
   * mock. Owner ruling 2026-08-20, and it is a better argument than the one
   * above: the card ALREADY distinguishes a returning household from a
   * first-time one — that is what R3's icon is — so a returning family with
   * no cabin string reads as "we do not know where they stayed", and a
   * first-time family needs no mark for housing it never had. The dash would
   * spend a glyph restating the icon beside it.
   *
   * `docs/reference/weekend-card-vocabulary.md` §6 carries the ruling.
   */
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
    expect(historyMark()).toBe('Returning family')
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

describe('FamilyCard — the need glyphs (kindred#2072)', () => {
  /*
   * The vocabulary this file now pins lives in
   * `docs/reference/weekend-card-vocabulary.md` §2 (what each mark means) and
   * §6 (the two policies with no other line of code to sit on: the absence
   * rule, and the closed hue set).
   *
   * These replace the two NEED chips — `Private bathroom` and `Power` — and
   * add two needs that had no card presence at all (`needs_fridge` #2224,
   * `needs_step_free` #2438 were graded for the drag hatch and drawn nowhere).
   */
  const needy = (flags: Record<string, boolean>, rest: Partial<RosterPartyRow> = {}) =>
    party({ flags: { ...flags }, ...rest })

  it('draws one icon-only glyph per asked need, in the closed set order', () => {
    render(
      <FamilyCard
        party={needy(
          { needs_private_bathroom: true, needs_power: true, needs_step_free: true },
          { effective_bathroom: 'private' }
        )}
        unit={confirmedUnit({ power_coverage: 'all', ramp_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('need-glyph-bathroom')).toBeInTheDocument()
    expect(screen.getByTestId('need-glyph-power')).toBeInTheDocument()
    expect(screen.getByTestId('need-glyph-step_free')).toBeInTheDocument()
    expect(screen.queryByTestId('need-glyph-fridge')).not.toBeInTheDocument()
  })

  it('carries no text label — the shape and the hue are the whole mark', () => {
    render(
      <FamilyCard
        party={needy({ needs_power: true })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByTestId('need-glyph-power').textContent).toBe('')
    // The chip it replaced, pinned gone.
    expect(screen.queryByText('Power')).not.toBeInTheDocument()
  })

  it('names the need in a reachable tooltip, not a title attribute', () => {
    // A glyph with no words is unreadable without one, and `title` fires on
    // mouse hover alone (kindred#2177). `ui/Tooltip` is the board's answer.
    render(
      <FamilyCard
        party={needy({ needs_private_bathroom: true }, { effective_bathroom: 'private' })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    const glyph = screen.getByTestId('need-glyph-bathroom')
    expect(glyph).not.toHaveAttribute('title')
    fireEvent.focus(glyph)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bathroom in unit')
  })

  it('takes the locked hue for a need the room meets', () => {
    // The mock renders #0ea5e9, which STANDS IN FOR `sky-500` rather than
    // equalling it — that is Tailwind v3's hex and this project ships v4,
    // where sky-500 renders #00a6f4. Never hand-written hex either way: §6
    // makes the app's scale the definition and the mock the approximation.
    render(
      <FamilyCard
        party={needy({ needs_power: true })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    const icon = screen.getByTestId('need-glyph-power').querySelector('svg')
    expect(icon?.getAttribute('class')).toContain('text-purple-500')
    expect(icon?.getAttribute('class')).toContain('dark:text-purple-400')
  })

  it('takes the warn fill, border and icon colour for a need the room does not meet', () => {
    // N2: the glyph goes red-filled. The SHAPE still says which need it is,
    // which is what makes losing the hue affordable.
    render(
      <FamilyCard
        party={needy({ needs_power: true })}
        unit={confirmedUnit({ power_coverage: 'none' })}
        onOpen={vi.fn()}
      />
    )
    const glyph = screen.getByTestId('need-glyph-power')
    expect(glyph.className).toContain('bg-red-100')
    expect(glyph.className).toContain('border-red-800')
    const icon = glyph.querySelector('svg')
    expect(icon?.getAttribute('class')).toContain('text-red-800')
    expect(icon?.getAttribute('class')).not.toContain('text-purple-500')
  })

  it('says so in the tooltip when the cabin does not meet it', () => {
    render(
      <FamilyCard
        party={needy({ needs_fridge: true })}
        unit={confirmedUnit({ fridge_coverage: 'none' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-fridge'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fridge — the cabin does not meet it')
  })

  it('OMITS a need nobody asked for — never dims it', () => {
    // THE ABSENCE RULE (§6), pinned on the card as well as on the resolver,
    // because "draw all four and grey the unasked ones" is the helpful thing
    // a later session adds.
    render(<FamilyCard party={party()} unit={confirmedUnit()} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('need-glyph-bathroom')).not.toBeInTheDocument()
    expect(screen.queryByTestId('need-glyph-power')).not.toBeInTheDocument()
    expect(screen.queryByTestId('need-glyph-fridge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('need-glyph-step_free')).not.toBeInTheDocument()
  })

  it('draws an asked need un-warned while the party is unplaced', () => {
    // No cabin to be a misfit for. A queue drawn red says nothing at all.
    render(<FamilyCard party={needy({ needs_power: true })} onOpen={vi.fn()} />)
    expect(screen.getByTestId('need-glyph-power').className).not.toContain('bg-red-100')
  })

  it('writes no hex into any glyph class', () => {
    /*
     * ⚠️ MOUNTS ALL FOUR, and that is the whole value of the sweep. The
     * implementation spec records the failure this repeats otherwise: an
     * earlier class-string sweep "silently checked a card that never mounted
     * the merge/split pills" — a sweep is only as good as what its render
     * mounts. Two of the four glyphs are NEW UI with no production precedent,
     * so they are exactly the ones a narrow sweep would miss.
     */
    const { container } = render(
      <FamilyCard
        party={needy({
          needs_private_bathroom: true,
          needs_power: true,
          needs_fridge: true,
          needs_step_free: true,
        })}
        unit={confirmedUnit({ power_coverage: 'none', fridge_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    // Every glyph in the closed set is actually on the card being swept.
    expect(container.querySelectorAll('[data-testid^="need-glyph-"]')).toHaveLength(4)
    const classes = [...container.querySelectorAll('*')]
      .flatMap((element) => [...element.classList])
      .join(' ')
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('FamilyCard — the marks kindred#2072 STRUCK', () => {
  /*
   * A CUT IS A RULING, and this codebase has twice restored an element whose
   * absence was undefended — `LodgingUnitCard.test.tsx`'s "no sr-only text of
   * any kind (kindred#2348)" describe records an
   * sr-only region that came back after being ruled out, twice. Every cut in
   * `weekend-card-vocabulary.md` §3 that lands on this card is pinned here.
   */
  const confirmed = confirmedUnit({ power_coverage: 'none' })

  it('draws no "Private bathroom" or "Power" NEED chip — the glyph is the mark', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_private_bathroom: true, needs_power: true } })}
        unit={confirmed}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText('Private bathroom')).not.toBeInTheDocument()
    expect(screen.queryByText('Power')).not.toBeInTheDocument()
  })

  it('draws no "No private bathroom" / "No power" chip — one fact stated twice', () => {
    /*
     * §3: a bathroom glyph beside a chip saying the bathroom is missing states
     * one fact twice. The glyph carries the state itself (N2).
     *
     * ⚠️ `needs_private_bathroom` IS SET, and without it half this test was
     * unfalsifiable (post-merge review of #2505, P1-2). The fixture used to
     * arm only `effective_bathroom: 'none'` — the SUPPLY side — so bathroom
     * never entered `partyAttention`'s `asked` list, `attention.reason` was
     * always exactly 'No power', and the `/No private bathroom/` assertion
     * could not fail however the chip came back. Demonstrated at the time:
     * adding a bathroom-specific verdict chip to `FamilyCardChips` passed all
     * 1415 weekend tests with a struck §3 mark back on the card.
     *
     * Arming both sides also gives the bathroom glyph's warn treatment its
     * first test on this card — no fixture anywhere asked for a bathroom AND
     * failed to get one.
     */
    render(
      <FamilyCard
        party={party({
          flags: { needs_power: true, needs_private_bathroom: true },
          effective_bathroom: 'none',
        })}
        unit={confirmed}
        onOpen={vi.fn()}
      />
    )
    // The demand side is really armed: the glyph is present and red.
    expect(screen.getByTestId('need-glyph-bathroom').className).toContain('bg-red-100')
    expect(screen.queryByText(/No power/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No private bathroom/)).not.toBeInTheDocument()
  })

  it('draws no "Fit not verified" chip — the whole unverified arm is struck', () => {
    // §3, `Reconfirm amenities`: the name was wrong on BOTH arms. Arm (a) is
    // superseded by the unit card's `Reconfirm space`; arm (b) fires BECAUSE
    // the cabin is confirmed, so "reconfirm" asked for a check already done.
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ is_confirmed: false })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText('Fit not verified')).not.toBeInTheDocument()
  })

  it('draws no "Fit not verified" chip for a generic accommodation either', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_accommodation: true } })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.queryByText('Fit not verified')).not.toBeInTheDocument()
  })

  it('draws no "Whole building" chip, and takes no prop that could ask for one', () => {
    // §3, "Earlier cuts, still struck". The chip survives on the MAP
    // (`MapUnitPopover`), which is a different surface and keeps its own copy.
    //
    // The PROP went with the chip, and that is defended by the type checker
    // rather than here: `holdsWholeBuilding` no longer exists on
    // `FamilyCardProps`, so a session wiring it back up fails `tsc` at the
    // call site before it reaches a test. `LodgingUnitCard.test` holds the
    // behavioural half, against a real whole-building placement.
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })

  it('draws no "Single parent" CHIP — the mark moved to line 2', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.queryByText('Single parent')).not.toBeInTheDocument()
  })
})

describe('FamilyCard — single parent is a mark on line 2 (S2 + Sa)', () => {
  it('marks the adult line of a household with exactly one attending adult', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    const mark = screen.getByTestId('family-card-single-parent')
    const adults = screen.getByTestId('family-card-adults')
    expect(adults.textContent).toContain('Emma Johnson')
    // BEFORE the adult name AND INSIDE the run, which is what makes it read as
    // a fact about that person rather than a preference in the chip row.
    //
    // Inside, not a preceding sibling: an `<svg>` has no baseline, so a flex
    // wrapper around the icon and the names took ITS baseline from the icon's
    // bottom edge and dropped line 2's right-anchored cabin 2.25px — on the
    // single-parent cards only, so a column of them showed the cabin
    // jittering. Pinned structurally because jsdom has no layout engine to
    // catch the pixels.
    expect(adults.firstElementChild).toBe(mark)
  })

  it('sits ON the baseline and is sized to the capital beside it', () => {
    /*
     * ⚠️ MEASURED AGAINST THE LETTER, NOT AGAINST THE LINE BOX (owner,
     * 2026-08-20). The mark shipped as `h-3 w-3 align-text-bottom` — a 12px
     * box hung from the DESCENDER line — and the owner read it off the screen
     * exactly: *"in the worktree its head top of the icon is below the top of
     * the S, and it extends lower than the text it is next to."*
     *
     * Confirmed in Chromium against the real font. The lucide `user` glyph
     * inks from y=2 to y=22 of its 24 viewBox (circle top 7−4−1, shoulder
     * bottom 21+1), so at 12px hung from text-bottom its ink began **0.75px
     * BELOW** the cap-top of the S and ran **2.75px BELOW** the baseline.
     *
     * `align-baseline` puts the box's bottom ON the baseline, which alone
     * guarantees the ink can never dip under the letters. 9px is then the size
     * whose ink top lands on the cap: +0.50px above it, against +1.42 at 10px
     * and +2.33 at 11px. The review artifact's own mark is 11px hung at
     * `vertical-align:-1px`, which measures +1.33 / −0.17 — the owner called
     * that close but wanted the top ON the S, and this is nearer.
     *
     * jsdom has no layout engine, so the classes are what is pinned here and
     * the numbers above are what the browser said.
     */
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    const mark = screen.getByTestId('family-card-single-parent')
    expect(mark.getAttribute('class')).toContain('align-baseline')
    expect(mark.getAttribute('class')).toContain('h-[9px]')
    expect(mark.getAttribute('class')).toContain('w-[9px]')
    // The old hanging alignment is what put it under the text.
    expect(mark.getAttribute('class')).not.toContain('align-text-bottom')
  })

  it('is AMBER — First-time’s tone, so amber means "notice this household" on both', () => {
    /*
     * Sa. It left the chip row, where it borrowed the sharing chips' muted
     * grammar and read as a preference.
     *
     * ⚠️ IT READS BOTH MARKS, and it did not before (post-merge review of
     * #2505, P1-4). The two ambers are independent literals in
     * `FamilyCard.tsx` with no shared token between them, and this test — the
     * only one that names the coupling — asserted the single-parent one alone.
     * Mutating the First-time branch to `rose-700` left the whole weekend
     * suite green, so "amber means notice this household across both marks"
     * could be made false with no signal at all. Asserting they are EQUAL is
     * the pin; asserting the literal twice would not be.
     */
    render(<FamilyCard party={party({ is_returning: false })} onOpen={vi.fn()} />)
    const singleParent = screen.getByTestId('family-card-single-parent')
    const firstTime = screen.getByTestId('family-card-history')

    expect(singleParent.getAttribute('class')).toContain('text-amber-700')
    expect(singleParent.getAttribute('class')).toContain('dark:text-amber-300')

    // The relationship the test is named for, not a second copy of the literal.
    const amberOf = (el: Element) =>
      (el.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((token) => token.includes('amber'))
        .sort()
        .join(' ')
    expect(amberOf(firstTime)).toBe(amberOf(singleParent))
  })

  it('draws Returning in the SEMANTIC green, not the lodge’s forest', () => {
    /*
     * ⚠️ MEASURED, NOT PREFERRED (owner, 2026-08-20, from a pixel comparison
     * against the review artifact). R3 rules an icon with NO WORDS, so
     * colour is the only thing separating Returning from First-time — and
     * `text-forest-700` resolves to `#003917` against a `--foreground` of
     * `#0c3125`. That is **1.08 : 1**: the mark was the same ink as the card's
     * own text, while First-time's amber sat at 2.82 : 1. The common mark —
     * 279 households of 402 — was the invisible one.
     *
     * `green-700` / `green-300` is 2.87 : 1 and is the artifact's own `--ret`.
     * It is also the ramp the Assign modal's `fits` verdict uses, so the board
     * carries ONE semantic green; `forest` stays what it has always been, the
     * lodge's chrome — buttons, headers, borders, the primary.
     *
     * jsdom cannot check contrast. The numbers above came from Chromium
     * against this app's own tokens; this pins the token they belong to.
     */
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    const mark = screen.getByTestId('family-card-history')
    expect(mark.getAttribute('class')).toContain('text-green-700')
    expect(mark.getAttribute('class')).toContain('dark:text-green-300')
    expect(mark.getAttribute('class')).not.toContain('forest')
  })

  it('does NOT share that amber with Returning, which is a different fact', () => {
    // The other half of Sa, and the reason the assertion above is an equality
    // rather than a sweep: amber says "notice this household". A returning
    // family is the ordinary case — 279 of 402 — so it must not wear it.
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    expect(screen.getByTestId('family-card-history').getAttribute('class')).not.toContain('amber')
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
    expect(screen.queryByTestId('family-card-single-parent')).not.toBeInTheDocument()
  })
})

describe('FamilyCard — Returning / First-time is a 20px icon, bottom right (R3)', () => {
  it('draws Returning as an icon with no text label, at the glyph row\u2019s own size', () => {
    /*
     * ⚠️ 20px, AND R3 ORIGINALLY RULED 16 (owner, 2026-08-20, after seeing the
     * two side by side at 4×). The mark shares a row with the need glyphs,
     * which are 20px chips, and it was bottom-aligned against them: measured
     * in Chromium, its 13.33px of ink sat 5.33px below the chips' top edge and
     * 1.33px above their bottom, so the one mark on the card that is not an
     * ask read as smaller and lower than the asks beside it. At 20px the ink
     * is 1.67px inside each edge — level with the run — and the row's height
     * does not change, because the chips already set it at 20px.
     *
     * The alternative was a 20px BOX around the 16px icon, which centres it
     * vertically but pushes its ink from 2px to 4px off the card's right
     * content edge. Rejected on that trade.
     *
     * The vocabulary doc's §2 row carries the new size and the reason.
     */
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
    const mark = screen.getByTestId('family-card-history')
    expect(mark.querySelector('svg')?.getAttribute('class')).toContain('h-5 w-5')
  })

  it('draws First-time at that size too — one mark, two states', () => {
    // The amber half must not be left at 16px: the two are the same mark and a
    // card shows exactly one of them, so a size difference would never be seen
    // side by side and would never be noticed until somebody measured.
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    const mark = screen.getByTestId('family-card-history')
    expect(mark.querySelector('svg')?.getAttribute('class')).toContain('h-5 w-5')
  })

  it('draws First-time as an icon with no text label', () => {
    render(<FamilyCard party={party()} onOpen={vi.fn()} />)
    expect(screen.queryByText('First-time')).not.toBeInTheDocument()
    expect(screen.getByTestId('family-card-history').querySelector('svg')).toBeInTheDocument()
  })

  it('names itself in a tooltip, since the icon carries no words', () => {
    render(<FamilyCard party={party({ is_returning: true })} onOpen={vi.fn()} />)
    fireEvent.focus(screen.getByTestId('family-card-history'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Returning family')
  })

  it('sits at the END of the chip row, pushed right and never wrapping', () => {
    render(
      <FamilyCard
        party={party({
          is_returning: true,
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
    const mark = screen.getByTestId('family-card-history')
    expect(mark.className).toContain('ml-auto')
    expect(mark.className).toContain('flex-shrink-0')
    // Last child of the row, after the wrapping chip group.
    expect(mark.parentElement?.lastElementChild).toBe(mark)
  })

  it('still draws nothing at all for a person-grain party', () => {
    // `is_returning` is only ever computed for household-grain parties, so an
    // adult weekend guest arrives with the Pydantic default `false` —
    // untracked, not "no".
    render(
      <FamilyCard party={party({ grain: 'person', display_name: 'Ada Okafor' })} onOpen={vi.fn()} />
    )
    expect(screen.queryByTestId('family-card-history')).not.toBeInTheDocument()
  })
})

describe('FamilyCard — the mandatory-accommodation chip is renamed', () => {
  it('reads "Needs Accommodation"', () => {
    // Renamed under kindred#2072; the label is EXPLICITLY NOT LOCKED and is
    // one of the five marks parked for staff input.
    render(
      <FamilyCard party={party({ flags: { accommodation_is_mandatory: true } })} onOpen={vi.fn()} />
    )
    expect(screen.getByText('Needs Accommodation')).toBeInTheDocument()
    expect(screen.queryByText('Accommodation required')).not.toBeInTheDocument()
  })
})
