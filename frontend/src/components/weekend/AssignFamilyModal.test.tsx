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

describe('AssignFamilyModal — the candidate rows', () => {
  it('carries the identity, the bed count and last year’s cabin', () => {
    /*
     * ⚠️ THE IDENTITY IS THE ATTENDING ADULTS, NOT THE CHILDREN — and this is
     * the one place the implementation departs from the review mock, which
     * draws `Isla (3) Nguyen`.
     *
     * `partyIdentityLabel` is the repo's identity for a party in a LIST: the
     * picker this modal replaces used it, `FloatingUnplacedBadge` sorts by it,
     * and kindred#2084 made it the replacement for the CampMinder salutation
     * across four surfaces. Matching the mock would mean a second
     * implementation of the family card's children-run — `youngestFirst` plus
     * `dedupeChildNames` plus the age formatter — in the very change that
     * exists to collapse duplicated rules. `partySearchText` already covers
     * both, so a staff member can find a household by a child's name either
     * way.
     *
     * The vocabulary doc rules nothing here, so this is a deliberate
     * divergence rather than a missed detail. If staff want the children, the
     * fix is to lift the run into `householdIdentity.ts` and call it from both
     * surfaces — never to copy it.
     */
    renderModal()
    const row = screen.getByTestId('candidate-household-102')
    expect(row).toHaveTextContent('Mai Nguyen')
    expect(row).toHaveTextContent('2')
    expect(row).toHaveTextContent('Lakeside')
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
    expect(screen.getByTestId('write-in-region')).toHaveTextContent('No family matches')
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

  it('keeps the header and the footer mounted through the flip, so nothing jumps', () => {
    renderModal()
    const header = screen.getByTestId('assign-capacity')
    const footer = screen.getByTestId('modal-footer')
    fireEvent.change(searchBox(), { target: { value: 'Burst pipe' } })
    expect(screen.getByTestId('assign-capacity')).toBe(header)
    expect(screen.getByTestId('modal-footer')).toBe(footer)
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
    expect(region).toHaveTextContent('Burst pipe')
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
