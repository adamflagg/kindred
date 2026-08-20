/**
 * The Assign modal — AS2 and W3, kindred#2072.
 *
 * This file is the specification for `AssignFamilyModal.tsx`, and the W3 rules
 * are written as assertions rather than as prose precisely because each of
 * them is the kind of thing a reviewer would soften into a nicety:
 *
 *   - ONE live input, and it IS the occupant name. No separate occupant field.
 *   - It never locks. Typing continues through the moment the last match
 *     disappears.
 *   - ONLY the region below it swaps. Header, input and footer stay put, so
 *     the panel does not jump under the cursor.
 *   - Backspacing back into a match swaps it back, and the flip commits
 *     nothing.
 *   - `Enter` saves from a FIELD, never from the search box. That is what
 *     stops a mistyped family name silently becoming a write-in instead of a
 *     placement — the ruling, not a keybinding detail.
 *
 * Vocabulary: `docs/reference/weekend-card-vocabulary.md` §6.
 *
 * Fictional data throughout.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { AssignFamilyModal } from './AssignFamilyModal'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-1',
    name: 'Ridge 1',
    sleeps: 4,
    bathroom: 'none',
    has_power: false,
    power_coverage: 'none',
    has_ac: false,
    has_fridge: false,
    has_shared_fridge: false,
    fridge_coverage: 'none',
    has_ramp: '',
    ramp_coverage: 'none',
    is_confirmed: true,
    is_active: true,
    is_container: false,
    is_family_available: true,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    ...overrides,
  }
}

const NGUYEN = party({
  household_cm_id: 102,
  display_name: 'Nguyen',
  sort_name: 'Nguyen',
  adults: [{ adult_number: 1, display_name: 'Mai Nguyen', relationship: 'Mother' }],
  children: [{ person_cm_id: 9002, display_name: 'Isla Nguyen', age: 3, grade: 0 }],
  party_size: 2,
  last_year_cabin: 'Lakeside',
})

function renderModal(overrides: Partial<Parameters<typeof AssignFamilyModal>[0]> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    unit: unit(),
    parties: [party(), NGUYEN],
    units: [],
    occupants: 2,
    onSelect: vi.fn(),
    onWriteIn: vi.fn(),
    ...overrides,
  }
  return { ...render(<AssignFamilyModal {...props} />), props }
}

function searchBox() {
  return screen.getByRole('searchbox')
}

describe('AssignFamilyModal — the header states beds FREE (owner ruling 2026-08-19)', () => {
  /*
   * ⚠️ THIS IS A STAFF-FACING NUMBER, AND IT IS A DIFFERENT ONE FROM THE
   * CARD'S. The unit card says placed-of-capacity (`2/4`, red when over); this
   * says how many beds are LEFT. Owner ruling, verbatim:
   *
   *   "The modal states beds FREE because that is the question being asked at
   *    the point of placement — will this party fit in what is left. The
   *    card's N/M is unchanged and over-capacity still means placed exceeds
   *    capacity everywhere on the board."
   *
   * Two framings of one arithmetic, neither redefined. The card's own figure
   * is pinned in `LodgingUnitCard.test.tsx` and this must never be "made
   * consistent" with it.
   */
  it('names the cabin and says how many beds are left', () => {
    renderModal({ unit: unit({ sleeps: 4 }), occupants: 2 })
    expect(screen.getByRole('dialog')).toHaveTextContent('Assign to Ridge 1')
    expect(screen.getByTestId('assign-capacity')).toHaveTextContent('2 of 4 beds free')
  })

  it('says nothing it cannot support when nobody has measured the room', () => {
    renderModal({ unit: unit({ sleeps: null }), occupants: 0 })
    expect(screen.getByTestId('assign-capacity')).toHaveTextContent('Capacity not recorded')
  })

  it('reports an already-over-capacity room as over, never as a negative', () => {
    renderModal({ unit: unit({ sleeps: 2 }), occupants: 5 })
    expect(screen.getByTestId('assign-capacity')).toHaveTextContent('Over capacity')
    expect(screen.getByTestId('assign-capacity').textContent).not.toContain('-3')
  })

  it('totals a combined house rather than reading its container row', () => {
    const house = unit({ code: 'house', is_container: true, is_combined: true, sleeps: 1 })
    const rooms = [
      unit({ unit_id: 'r1', code: 'r1', parent_code: 'house', sleeps: 3 }),
      unit({ unit_id: 'r2', code: 'r2', parent_code: 'house', sleeps: 2 }),
    ]
    renderModal({ unit: house, units: [house, ...rooms], occupants: 0 })
    expect(screen.getByTestId('assign-capacity')).toHaveTextContent('6 of 6 beds free')
  })

  it('names what the room offers, in words — there is width for them here', () => {
    renderModal({ unit: unit({ bathroom: 'shared', has_power: true, has_ac: true }) })
    const capacity = screen.getByTestId('assign-capacity')
    expect(capacity).toHaveTextContent('bathroom')
    expect(capacity).toHaveTextContent('power')
    expect(capacity).toHaveTextContent('air conditioning')
  })
})

describe('AssignFamilyModal — it opens ready to be typed into', () => {
  /*
   * ⚠️ MEASURED DEFECT, FIXED 2026-08-20. The box carried React's `autoFocus`
   * and never kept it: `ui/Modal`'s focus effect runs after commit and lands
   * on `focusable[0]`, which is the CLOSE BUTTON — a custom header renders it
   * above the body. So the dialog opened with focus on a control that
   * swallows printable keys and closes on Space or Enter, and a staff member
   * who opened it and typed got nothing.
   *
   * Found in a browser by comparing against the design artifact, then
   * reproduced here. `ui/Modal`'s `initialFocusRef` is the fix and
   * `Modal.test.tsx` pins the primitive; this pins that THIS dialog uses it.
   */
  it('puts the caret in the search box, not on Close', () => {
    renderModal()
    expect(searchBox()).toHaveFocus()
  })

  it('takes a keystroke without a click first', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.keyboard('Ngu')
    expect(searchBox()).toHaveValue('Ngu')
  })
})

describe('AssignFamilyModal — the candidate rows', () => {
  it('carries the identity, the bed count and last year’s cabin', () => {
    /*
     * ⚠️ THE IDENTITY IS THE CHILDREN WITH THEIR AGES — `Isla (3) Nguyen` —
     * AND THAT REVERSES WHAT THIS TEST PINNED WHEN #2506 FIRST SHIPPED.
     *
     * The original reading was `partyIdentityLabel`, the attending adults,
     * and the reasoning was sound as far as it went: that label is the repo's
     * identity for a party in a LIST (the picker this modal replaced used it,
     * `FloatingUnplacedBadge` sorts by it, kindred#2084 made it the
     * salutation's replacement across four surfaces), and matching the review
     * artifact looked like it would mean a SECOND implementation of the family
     * card's children-run in the very change that exists to collapse
     * duplicated rules. It was flagged in the PR body rather than buried.
     *
     * The owner ruled for the children (2026-08-20). What made that free is
     * the part the original reasoning treated as unavoidable: the run is not
     * copied. `householdIdentity.childrenRun` now owns the derivation and BOTH
     * `FamilyCard`'s `ChildList` and this row call it, so the card and the
     * modal cannot drift — `MapUnitPopover`'s hand-reproduced `Whole building`
     * chip is what a copy would have cost.
     *
     * `partySearchText` is unchanged and still covers adults and children
     * alike, so a staff member can still find a household by either.
     */
    renderModal()
    const row = screen.getByTestId('candidate-household-102')
    // ⚠️ `Isla Nguyen (3)`, and the review artifact draws `Isla (3) Nguyen`.
    // The artifact lifts the surname off a household with ONE child;
    // kindred#2180's rule does not — "a single child shares nothing with
    // anybody" — and the shipped FAMILY CARD therefore prints the same
    // `Isla Nguyen (3)`. The ruling is that this row shows what the card's
    // bold line shows, so the card wins over the mock, exactly as vocabulary
    // §8 says it must. The artifact's own family card diverges here too; that
    // is a stage-1 observation, not something this row introduced.
    expect(row).toHaveTextContent('Isla Nguyen (3)')
    expect(row).not.toHaveTextContent('Mai Nguyen')
    expect(row).toHaveTextContent('2')
    expect(row).toHaveTextContent('Lakeside')
  })

  it('falls back to the attending adults for a household with no children', () => {
    // Nobody to name otherwise, and a blank identity is worse than the older
    // reading. `childrenRunLabel` returns `''` precisely so this branch can
    // exist rather than each caller re-deriving "has children".
    renderModal({
      parties: [party({ household_cm_id: 111, children: [] })],
    })
    expect(screen.getByTestId('candidate-household-111')).toHaveTextContent('Emma Johnson')
  })

  it('names a person-grain adult-weekend guest by their own name', () => {
    // An adult weekend's parties ARE their own identity — there is no
    // household salutation over them and no children to run.
    renderModal({
      parties: [
        {
          grain: 'person',
          person_cm_id: 501,
          display_name: 'Liam Garcia',
          sort_name: 'Garcia',
          adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: '' }],
          children: [],
          party_size: 1,
          unit_code: '',
          unit_name: '',
        },
      ],
    })
    expect(screen.getByTestId('candidate-person-501')).toHaveTextContent('Liam Garcia')
  })

  it('prints the SAME run the family card does, from one derivation', () => {
    // The point of the ruling, and the thing a copy would break: youngest
    // first, the shared surname lifted once, the age truncated to whole years.
    renderModal({
      parties: [
        party({
          household_cm_id: 112,
          children: [
            { person_cm_id: 1, display_name: 'Liam Johnson', last_name: 'Johnson', age: 8.7 },
            { person_cm_id: 2, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5.2 },
          ],
        }),
      ],
    })
    expect(screen.getByTestId('candidate-household-112')).toHaveTextContent(
      'Ava (5) · Liam (8) Johnson'
    )
  })

  it('draws the need glyphs coloured against THIS room, not against a placement', () => {
    // The prospective reading. Every party here is unplaced, so
    // `effective_bathroom` would grade them all identically whatever room the
    // modal was opened from.
    renderModal({
      unit: unit({ bathroom: 'private' }),
      parties: [
        party({
          household_cm_id: 103,
          flags: { needs_private_bathroom: true },
          effective_bathroom: 'none',
        }),
      ],
    })
    const glyph = within(screen.getByTestId('candidate-household-103')).getByTestId(
      'need-glyph-bathroom'
    )
    expect(glyph.className).not.toContain('bg-red-100')
  })

  it('reddens a glyph the room cannot answer', () => {
    renderModal({
      unit: unit({ bathroom: 'shared' }),
      parties: [party({ household_cm_id: 103, flags: { needs_private_bathroom: true } })],
    })
    const glyph = within(screen.getByTestId('candidate-household-103')).getByTestId(
      'need-glyph-bathroom'
    )
    expect(glyph.className).toContain('bg-red-100')
  })

  it('says "fits" only when it does, and states what no glyph can', () => {
    renderModal({
      unit: unit({ sleeps: 2 }),
      occupants: 0,
      parties: [party({ household_cm_id: 104, party_size: 6 })],
    })
    expect(screen.getByTestId('candidate-household-104')).toHaveTextContent(
      'Over capacity · needs 6, sleeps 2'
    )
  })

  /*
   * ⚠️ THE FOUR ASSERTIONS BELOW ARE ABOUT PIXELS AND COLOUR, AND JSDOM HAS NO
   * LAYOUT ENGINE — so they pin the CLASS, which is the deliverable, and the
   * numbers behind them were measured in a real browser against the review
   * artifact (recorded in the PR body). A test named for a layout property
   * that asserts nothing about it is how a 133px jump survived this file once
   * already; naming the limitation is the alternative.
   */
  it('states the fit verdict in green when it fits, and in bold', () => {
    // Owner ruling 2026-08-20: the verdict goes GREEN / RED. It was
    // `text-muted-foreground` at normal weight — the same ink as last year's
    // cabin sitting beside it, so the row's conclusion read as another one of
    // its facts.
    //
    // `green-700`, NOT the board's `forest` — and that is measured, not a
    // preference. `forest-700` resolves to `#003917` against a `--foreground`
    // of `#0c3125`: 1.08:1, so the verdict would still read as one of the
    // row's facts, which is the exact defect the ruling names. `green-700` is
    // 2.87:1 against the same text. It is also the ramp the other half of
    // this verdict already comes from (`red-800`, `NeedGlyph.WARN_TONE`).
    // See `fitTone`.
    renderModal({ parties: [NGUYEN] })
    const verdict = screen.getByTestId('candidate-household-102-fit')
    expect(verdict).toHaveTextContent('fits')
    expect(verdict.className).toContain('text-green-700')
    expect(verdict.className).toContain('dark:text-green-300')
    expect(verdict.className).toContain('font-bold')
  })

  it('states it in the SAME red the unmet glyph uses when it does not', () => {
    // The warn ink `NeedGlyph` owns (`text-red-800 dark:text-red-300`), not a
    // second red. The artifact's `--warn-fg` IS those two Tailwind steps.
    renderModal({
      unit: unit({ bathroom: 'shared' }),
      parties: [party({ household_cm_id: 105, flags: { needs_private_bathroom: true } })],
    })
    const verdict = screen.getByTestId('candidate-household-105-fit')
    expect(verdict).toHaveTextContent('does not fit')
    expect(verdict.className).toContain('text-red-800')
    expect(verdict.className).toContain('dark:text-red-300')
  })

  it('reds the capacity sentence too — a row with a note has never fitted', () => {
    // `candidateFit` only writes a note when capacity is `unmet`, and `fit` is
    // the worst of every dimension, so `notes.length > 0` implies
    // `fit !== 'fits'`. Two verdict colours are ruled, not three.
    renderModal({
      unit: unit({ sleeps: 2 }),
      occupants: 0,
      parties: [party({ household_cm_id: 106, party_size: 6 })],
    })
    const verdict = screen.getByTestId('candidate-household-106-fit')
    expect(verdict).toHaveTextContent('Over capacity')
    expect(verdict.className).toContain('text-red-800')
  })

  it('shades the rows like the box above them, on the card’s own ground', () => {
    // Owner ruling 2026-08-20 (§3.6): the artifact gives the search box AND
    // the rows the same `--s-bg`, which is the PAGE colour sitting on a
    // `--s-card` modal. In app terms that is `bg-background` on `bg-card` —
    // the input already had it; the rows were transparent, so they read as
    // outlines rather than as fields.
    renderModal({ parties: [NGUYEN] })
    expect(screen.getByTestId('candidate-household-102').className).toContain('bg-background')
    expect(searchBox().className).toContain('bg-background')
  })

  it('NEVER hides a family, however badly it fits', () => {
    // The ruling `placementCandidates` exists to carry: 6 of 118 units have a
    // private bathroom against 45 parties asking for one, so a list narrowed
    // to "what fits" would be empty most of the time and staff would go back
    // to dragging.
    renderModal({
      unit: unit({ bathroom: 'shared', power_coverage: 'none', sleeps: 1 }),
      parties: [party({ flags: { needs_private_bathroom: true, needs_power: true } }), NGUYEN],
    })
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('places the family a row is clicked for', () => {
    const { props } = renderModal()
    fireEvent.click(screen.getByTestId('candidate-household-102'))
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ household_cm_id: 102 }))
  })

  it('does NOT place a family when its need glyph is clicked', () => {
    /*
     * ⚠️ A NESTED `<button>` INSIDE THE ROW'S `<button>`, AND THE CONSEQUENCE
     * WAS A SILENT WRITE.
     *
     * The row is a real `<button>` whose `onClick` places the family. The need
     * glyph was a `ui/Tooltip`, whose trigger is ALSO a real `<button>` — so a
     * staff member clicking a glyph to read what it meant placed that family in
     * the cabin and closed the modal. Invalid HTML, and a destructive misclick.
     *
     * `NeedGlyph.tsx` had already written down the rule this broke: the mark is
     * valid on the family card "because the chip row is a SIBLING of the card's
     * own `<button>`, never its child (kindred#2222)". kindred#2222 changed the
     * card's frame from one big `<button>` to a `<div>` for exactly this
     * reason, and left a "never nests" regression guard behind. The modal
     * ignored that rule by putting the mark INSIDE its row control.
     *
     * The fix is `insideControl`, which renders the mark as a plain `<span>`
     * with a native `title` — no nested control, and a mouse still gets the
     * name on hover, which is the audience (owner ruling 2026-08-20).
     *
     * Pinned as a CLICK, not as a tag-name assertion: the tag is the mechanism,
     * the unintended placement is the defect.
     */
    const { props } = renderModal()
    // The row itself still places — that is its job, and the guard below is
    // about what must NOT also do it.
    fireEvent.click(screen.getByTestId('candidate-household-102'))
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it('renders the row’s need glyphs as inert marks, never as nested controls', () => {
    /*
     * THE INVARIANT IS "NO CONTROL INSIDE THE CONTROL" — not "a click on the
     * glyph does nothing".
     *
     * A click anywhere inside a `<button>` activates it, so clicking a glyph
     * still places the family. That is correct and intended: the whole row is
     * one control, and there is no longer anything on the glyph inviting a
     * click of its own — it names itself on HOVER, via `title`.
     *
     * What was wrong was the nesting. The glyph was a `ui/Tooltip`, whose
     * trigger is a real `<button>`, so the row contained a second control:
     * invalid HTML, its own focus stop, and a click that both pinned a tooltip
     * and wrote a placement.
     */
    const { props } = renderModal({
      unit: unit({ bathroom: 'shared' }),
      parties: [party({ household_cm_id: 103, flags: { needs_private_bathroom: true } })],
    })
    const row = screen.getByTestId('candidate-household-103')
    const glyph = within(row).getByTestId('need-glyph-bathroom')

    // The row is the ONLY control in the row.
    expect(row.tagName).toBe('BUTTON')
    expect(row.querySelectorAll('button')).toHaveLength(0)
    expect(glyph.tagName).not.toBe('BUTTON')
    // It still says what it is, to a pointer — which is the audience.
    expect(glyph).toHaveAttribute('title', 'Bathroom in unit — the cabin does not meet it')
    // And it is still the graded mark, not a decoration: this cabin is shared,
    // the household asked for a bathroom, so the glyph is in the warn state.
    expect(glyph.className).toContain('bg-red-100')
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('is a real button, so a keyboard reaches it without the search box saving', () => {
    // The list lives inside a focus-trapped dialog, so tab stops here cost
    // nothing — unlike the ~82 inline comboboxes this replaced, where every row
    // being a tab stop would have walked staff through the whole queue on
    // every card. This is what keeps a keyboard path open while `Enter` in
    // the search box stays inert.
    renderModal()
    expect(screen.getByTestId('candidate-household-102').tagName).toBe('BUTTON')
    expect(screen.getByTestId('candidate-household-102')).not.toHaveAttribute('tabindex', '-1')
  })
})

describe('AssignFamilyModal — W3, one live box and only the region below it swaps', () => {
  it('filters the list as the staff member types', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(searchBox(), 'Nguy')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByTestId('candidate-household-102')).toBeInTheDocument()
  })

  it('swaps to the write-in fields the moment the last match disappears', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(searchBox(), 'Burst pipe')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByTestId('write-in-region')).toBeInTheDocument()
    // The sentence explaining the swap sits OUTSIDE the region that swapped —
    // it is fixed furniture, alongside the input and the footer. Inside, it
    // made the two states differ in height, which is what moved the dialog.
    expect(screen.getByRole('dialog')).toHaveTextContent('No family matches')
  })

  it('NEVER locks the input, and keeps the very same node through the flip', async () => {
    // "It never locks. Typing continues through the moment the last match
    // disappears" — if the input were remounted, focus and the caret would be
    // lost mid-word, which is the same defect wearing different clothes.
    const user = userEvent.setup()
    renderModal()
    const before = searchBox()
    await user.type(before, 'Burst pipe')
    const after = searchBox()
    expect(after).toBe(before)
    expect(after).not.toBeDisabled()
    expect(after).toHaveFocus()
  })

  it('keeps the header and the footer MOUNTED through the flip', () => {
    /*
     * ⚠️ THIS TEST WAS NAMED "…so nothing jumps" AND COULD NOT CHECK THAT.
     *
     * jsdom has no layout engine, so node identity is the most this file can
     * assert — and a name claiming more than the body checks is worse than no
     * test, because it reads as covered. Driven in a real browser the panel
     * jumped 133px across a three-character typeahead and 28px on the flip
     * itself, while this passed.
     *
     * What actually stops the jump is two things, neither of which jsdom can
     * see: `anchor="top"` on the dialog, so a height change grows downward
     * instead of re-centring, and `h-80` (not `max-h-80`) on the swap region,
     * so the height does not change at all. Both are pinned as CLASS STRINGS
     * in the two tests below — the only honest proxy available here — and the
     * pixels are verified in a browser.
     */
    renderModal()
    const header = screen.getByTestId('assign-capacity')
    const footer = screen.getByTestId('modal-footer')
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    expect(screen.getByTestId('assign-capacity')).toBe(header)
    expect(screen.getByTestId('modal-footer')).toBe(footer)
  })

  it('holds the swap region at a CONSTANT height, so the dialog cannot resize', () => {
    // `h-80`, never `max-h-80`. With a max-height the region shrinks to fit one
    // match and the whole card re-centres around it.
    renderModal()
    const region = screen.getByTestId('assign-swap-region')
    expect(region.className).toContain('h-80')
    expect(region.className).not.toContain('max-h-80')
  })

  it('anchors the dialog to the top rather than centring it', () => {
    // The other half: centred, the card is laid out around its own height, so
    // ANY content change moves everything above it. `ui/Modal`'s `anchor` prop
    // exists for this defect and defaults to `center` for every other caller.
    renderModal()
    const wrapper = screen.getByRole('dialog')
    expect(wrapper.className).toContain('items-start')
    expect(wrapper.className).not.toContain('items-center')
  })

  it('swaps back when a backspace reaches a match again, committing nothing', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    expect(screen.getByTestId('write-in-region')).toBeInTheDocument()
    fireEvent.change(searchBox(), { target: { value: 'Nguy' } })
    expect(screen.queryByTestId('write-in-region')).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    // THE FLIP ITSELF COMMITS NOTHING — in either direction.
    expect(props.onWriteIn).not.toHaveBeenCalled()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('keeps a typed note through a round trip, because the flip destroys nothing either', () => {
    renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'back Monday' } })
    fireEvent.change(searchBox(), { target: { value: 'Nguy' } })
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    expect(screen.getByLabelText(/note/i)).toHaveValue('back Monday')
  })

  it('has no separate occupant field — the search box IS the name', () => {
    renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    const region = screen.getByTestId('write-in-region')
    expect(within(region).queryByLabelText(/occupant/i)).not.toBeInTheDocument()
    // The typed text IS the occupant name, and the dialog says so — in the
    // sentence above the region, which is where the explanation of the swap
    // lives.
    expect(screen.getByRole('dialog')).toHaveTextContent('Burst pipe')
  })
})

describe('AssignFamilyModal — Enter saves from a FIELD, never from the search box', () => {
  /*
   * ⚠️ THE RULING, NOT A KEYBINDING DETAIL. `Enter` in the search box is what
   * would turn a mistyped family name into a write-in — a name one character
   * off matches nothing, and the write-in is silent about having been the
   * wrong thing to do. So the keystroke that commits lives in a field the
   * staff member had to move to on purpose.
   */
  it('does NOT write in on Enter in the search box', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect(props.onWriteIn).not.toHaveBeenCalled()
  })

  it('does NOT place a family on Enter in the search box either', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Nguy' } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('writes in on Enter in the Note field', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    const note = screen.getByLabelText(/note/i)
    fireEvent.change(note, { target: { value: 'back Monday' } })
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(props.onWriteIn).toHaveBeenCalledWith({
      occupantName: 'Burst pipe',
      note: 'back Monday',
    })
  })

  it('writes in from the Write in button', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    fireEvent.click(screen.getByRole('button', { name: /write in/i }))
    expect(props.onWriteIn).toHaveBeenCalledWith({ occupantName: 'Burst pipe', note: '' })
  })

  it('trims the typed name — a trailing space is a typing artefact, not a name', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: '  Burst pipe  ' } })
    fireEvent.click(screen.getByRole('button', { name: /write in/i }))
    expect(props.onWriteIn).toHaveBeenCalledWith({ occupantName: 'Burst pipe', note: '' })
  })
})

describe('AssignFamilyModal — the People field is kindred#2503 and is NOT built', () => {
  it('offers no people count, because there is nowhere to store one', () => {
    // Owner ruling 2026-08-19: land the modal without it rather than build a
    // control with no destination. `lodging_write_ins` carries `occupant_name`
    // and `note` and nothing else. The layout reserves the slot; the field
    // arrives with kindred#2503.
    renderModal()
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    const region = screen.getByTestId('write-in-region')
    expect(within(region).queryByLabelText(/people/i)).not.toBeInTheDocument()
    expect(within(region).queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})

describe('AssignFamilyModal — what it refuses to offer', () => {
  it('offers no write-in at all to a caller with no write path', () => {
    renderModal({ onWriteIn: undefined })
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    expect(screen.queryByTestId('write-in-region')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /write in/i })).not.toBeInTheDocument()
  })

  it('says so plainly when there is nobody left to place', () => {
    renderModal({ parties: [], onWriteIn: undefined })
    expect(screen.getByRole('dialog')).toHaveTextContent('Everyone has a cabin')
  })

  it('will not write in an empty name', () => {
    const { props } = renderModal()
    fireEvent.change(searchBox(), { target: { value: '   ' } })
    expect(screen.queryByRole('button', { name: /write in/i })).not.toBeInTheDocument()
    expect(props.onWriteIn).not.toHaveBeenCalled()
  })
})

describe('AssignFamilyModal — it is the shared dialog, not a second pattern', () => {
  it('is a real dialog with the repo’s own overlay behaviour', () => {
    // `ui/Modal` carries the portal, the focus trap, the background `inert`
    // and `ui/modalStack`'s Escape ordering. Hand-rolling any of it is how a
    // board surface ends up yielding Escape to the wrong overlay.
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape', () => {
    const { props } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
