/**
 * The occupant card a write-in draws in the unit's well — kindred#2078.
 *
 * Fictional data throughout.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WriteInCard, WRITE_IN_FRAME } from './WriteInCard'

describe('WriteInCard', () => {
  it('prints the occupant as a NAME, in the position the board uses for placed families', () => {
    render(<WriteInCard occupant={{ name: 'Emma Johnson', note: '', partySize: null }} />)

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('carries the note INSIDE the card, describing the occupant rather than the room', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun', partySize: null }}
      />
    )

    expect(screen.getByText('Kitchen lead, Fri–Sun')).toBeInTheDocument()
  })

  it('says so plainly when nobody named the occupant', () => {
    // Reachable from a row written before 1500000148 with an empty note, or
    // through the permissive write schema. The room is still closed, so an
    // EMPTY card would read as an open room the board refuses drops on.
    render(<WriteInCard occupant={{ name: '', note: '', partySize: null }} />)

    expect(screen.getByText('Occupant not named')).toBeInTheDocument()
  })

  it('renders no note row at all when there is none', () => {
    // The note ships EMPTY on every historical row by construction, so this is
    // the common case rather than the edge one.
    const { container } = render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} />
    )

    expect(container.textContent).toBe('Liam Garcia')
  })

  it('does NOT mark itself as a family card', () => {
    // `FamilyCard` sets `data-family-card` and board code queries that selector
    // to find PLACED parties. A write-in is an occupant, not a placement: a
    // card carrying the attribute would be counted as a family in a room no
    // family is in.
    const { container } = render(
      <WriteInCard occupant={{ name: 'Emma Johnson', note: '', partySize: null }} />
    )

    expect(container.querySelector('[data-family-card]')).toBeNull()
  })

  it('is not draggable, and the CARD itself is never a button', () => {
    // `FamilyCard` is a `<button>` that opens the family panel and a dnd-kit
    // draggable. There is no panel behind a write-in and nowhere to drag it —
    // a card that looks interactive and is not is worse than plain text. The
    // corner control below is a real button; the card body stays inert.
    const { container } = render(
      <WriteInCard occupant={{ name: 'Emma Johnson', note: '', partySize: null }} />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })

  it('wraps a long occupant name instead of truncating it (kindred#2431)', () => {
    // Owner ruling, 2026-08-18: WRAP, following the #2253 precedent — a
    // truncated name is not a shorter name, it is a different one, and two
    // write-ins sharing a prefix would render identically.
    render(
      <WriteInCard occupant={{ name: 'Alexandra Vandenberg-Okonkwo', note: '', partySize: null }} />
    )

    const nameSpan = screen.getByText('Alexandra Vandenberg-Okonkwo')
    expect(nameSpan.className).not.toMatch(/\btruncate\b/)
    // `min-w-0` STAYS: it is what lets the flex child shrink below its
    // content width, which is what makes it wrap rather than overflow the
    // card (same reasoning `HouseholdJourneyCard` records for its own span).
    expect(nameSpan.className).toMatch(/\bmin-w-0\b/)
  })

  it("wears FamilyCard's frame verbatim, so the two cannot drift apart", () => {
    // A SOURCE assertion, not a rendered one, and deliberately so. `CARD_FRAME`
    // is module-private to `FamilyCard.tsx` and that file is owned by another
    // change in flight, so this card restates the string rather than importing
    // it. Restating it silently is how two cards that must look identical stop
    // looking identical; this is the guard that makes the copy loud.
    const familyCard = readFileSync(resolve(__dirname, './FamilyCard.tsx'), 'utf-8')
    const match = /const CARD_FRAME =\s*'([^']*)'/.exec(familyCard)

    expect(match).not.toBeNull()
    expect(WRITE_IN_FRAME).toBe(match?.[1])
  })
})

describe('the corner control that removes THIS write-in', () => {
  /*
   * Owner ruling, 2026-08-18 (kindred#2381 part 4): a small X in each card's
   * top-right, one per write-in — not a row of full "Clear Write-in" buttons,
   * which was refused, and not one control for a well that may hold four.
   *
   * It is what makes the plural card safe. The single control it replaces
   * named whichever row the server resolved first, so on a merged building
   * carrying four write-ins a click removed one, the card re-populated with
   * the next occupant, and the action read as a no-op — four clicks destroyed
   * four rows with nothing ever disclosing that more than one existed.
   */
  it('is absent when the reader cannot remove anything', () => {
    // No `bunking.manage`, and therefore no handler. A control that does
    // nothing is worse than no control.
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the occupant it would remove, so four of them are four questions', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onRemove={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeInTheDocument()
  })

  it('still offers a removal for a write-in nobody named', () => {
    render(
      <WriteInCard occupant={{ name: '', note: '', partySize: null }} onRemove={() => undefined} />
    )

    expect(
      screen.getByRole('button', { name: 'Remove write-in Occupant not named' })
    ).toBeInTheDocument()
  })

  it('calls back exactly once, with no argument to get wrong', () => {
    // The CARD knows which row it draws; the caller binds the target. Passing
    // an id up from here would be a second place that has to agree about
    // which of the four rows this card is.
    const onRemove = vi.fn()
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onRemove={onRemove}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('is disabled while a write to this row is in flight', () => {
    // RENAMED from `isRemoving` (kindred#2430): the flag now gates the edit
    // pencil too, since both controls write the same row.
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onRemove={() => undefined}
        onEdit={() => undefined}
        isSaving
      />
    )

    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' })).toBeDisabled()
  })
})

describe('the corner control that edits THIS write-in (kindred#2430)', () => {
  /*
   * Owner ruling, 2026-08-18 (supersedes an earlier same-day HOLD): a small
   * pencil, ALWAYS VISIBLE, beside #2381's X — not shown only on hover
   * (staff could not find the edit path in the first place, so a hidden
   * control does not fix that) and not click-the-card (`WriteInCard.tsx:18`
   * documents the card as deliberately not a button; a discrete control
   * preserves that rather than reversing it).
   *
   * No API change: `set_availability` already upserts a write-in's row
   * (`_upsert_row(what='write-in', ...)` in
   * `api/services/lodging_write_service.py`), so a second write to the same
   * row updates it in place. This control only has to collect the edit and
   * send the same shape the write path has always taken — the shape
   * `UnitAvailabilityControl`'s occupant prompt sent until that control was
   * cut (kindred#2072 stage 3), and the one `writeIn.ts` now owns the type
   * for.
   */
  it('is absent when the reader cannot edit', () => {
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} />)

    expect(screen.queryByRole('button', { name: /edit write-in/i })).not.toBeInTheDocument()
  })

  it('renders beside the X with no hover-only class — ALWAYS visible', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onRemove={() => undefined}
        onEdit={() => undefined}
      />
    )

    const pencil = screen.getByRole('button', { name: 'Edit write-in Liam Garcia' })
    // A hover-reveal control would still be IN the DOM (CSS hides it), so
    // presence alone cannot tell the two apart — the className has to be
    // checked for the classes that would make it hover-only.
    expect(pencil.className).not.toMatch(/opacity-0/)
    expect(pencil.className).not.toMatch(/group-hover/)
    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeInTheDocument()
  })

  it('still offers an edit for a write-in nobody named', () => {
    render(
      <WriteInCard occupant={{ name: '', note: '', partySize: null }} onEdit={() => undefined} />
    )

    expect(
      screen.getByRole('button', { name: 'Edit write-in Occupant not named' })
    ).toBeInTheDocument()
  })

  it('labels both boxes with the prompt\u2019s own placeholders', () => {
    // The note is EMPTY on every row predating kindred#2078 (1500000148
    // cleared each one it copied), so without a placeholder the second box is
    // a blank unlabelled input under the name. What this shares with the
    // Assign modal's write-in form is the SHAPE — a name box with an optional
    // note under it — and not the strings: the modal opens on a picker rather
    // than on a row that already names someone, so it words its own pair
    // `Write in a name…` and `Optional — e.g. back Monday`. (These two came
    // from `UnitAvailabilityControl`'s occupant prompt, which was cut in
    // kindred#2072 stage 3 — the strings outlived it.)
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByRole('textbox', { name: 'Occupant' })).toHaveAttribute(
      'placeholder',
      'Emma Johnson, burst pipe…'
    )
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveAttribute(
      'placeholder',
      'Note (optional) — back Monday…'
    )
  })

  it('opens an inline form pre-filled with the occupant and note already on the row', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: 'Kitchen lead, Fri–Sun', partySize: null }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByRole('textbox', { name: 'Occupant' })).toHaveValue('Liam Garcia')
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue(
      'Kitchen lead, Fri–Sun'
    )
  })

  it('calls back once with the trimmed occupant and note, and closes the form', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), {
      target: { value: '  Liam Garcia-Reyes  ' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note (optional)' }), {
      target: { value: 'Back Monday' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia-Reyes',
      reason: 'Back Monday',
      // The row this test seeds carries no recorded count, so the untouched
      // People field sends `null` — kindred#2503's edit form, task 10.
      partySize: null,
    })
    expect(screen.queryByRole('textbox', { name: 'Occupant' })).not.toBeInTheDocument()
  })

  it('refuses an empty occupant name, the same guard the write-in prompt uses', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Occupant' })).toBeInTheDocument()
  })

  it('lets Cancel close the form without writing anything', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), {
      target: { value: 'Somebody Else' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Occupant' })).not.toBeInTheDocument()
    // The original label is still what the card prints — nothing was
    // written, so nothing changed.
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('re-opens pre-filled from the CURRENT row, not a stale draft left over from a cancelled edit', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), {
      target: { value: 'Abandoned Draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByRole('textbox', { name: 'Occupant' })).toHaveValue('Liam Garcia')
  })
})

describe("the pencil's People field, kindred#2503", () => {
  /*
   * ⚠️⚠️ THE DATA-LOSS GUARD. `set_availability`'s write-in upsert
   * (`api/services/lodging_write_service.py:958-969`) includes `party_size`
   * UNCONDITIONALLY on every write to a write-in row. Before this field
   * existed, `LodgingUnitCard.tsx`'s `onEdit` handler forwarded
   * `entry.occupant.partySize` — the row's already-recorded count — rather
   * than `null`, specifically so that editing a name or note could never
   * erase a headcount a staff member had already typed. This describe block
   * pins the same invariant one layer down, at the field this card now owns:
   * saving the form WITHOUT touching People must still send the recorded
   * count, and only a deliberate clear may send `null`.
   */
  it("seeds from the row's recorded count", () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: 3 }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByLabelText('People')).toHaveValue(3)
  })

  it('is empty for a row with no recorded count', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByLabelText('People')).toHaveValue(null)
  })

  it('saves the recorded count untouched — the data-loss guard', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: 3 }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    // NO CHANGE to People — the pencil is only touching the name/note in the
    // common case this guards.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia',
      reason: '',
      partySize: 3,
    })
  })

  it('clears a recorded count back to wholesale, a real edit that sends `null`', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: 3 }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia',
      reason: '',
      partySize: null,
    })
  })

  it('refuses a typed 0, rather than saving it', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('refuses a fraction rather than silently truncating it (IMPORTANT C)', () => {
    // `Number.parseInt('1.5', 10)` is `1` — a silent drop the owner ruling
    // forbids. `Number('1.5')` is `1.5`, caught by `Number.isInteger`.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('reads exponential notation as the number it names, not a truncated digit', () => {
    // `Number.parseInt('1e3', 10)` is `1`. `Number('1e3')` is `1000`.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '1e3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia',
      reason: '',
      partySize: 1000,
    })
  })

  it('saves on Enter from People, as it does from the other fields (weekend-card-vocabulary.md §6)', () => {
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '2' } })
    fireEvent.keyDown(screen.getByLabelText('People'), { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia',
      reason: '',
      partySize: 2,
    })
  })

  it('disables Save while People holds an invalid count, matching the Assign modal’s gate', () => {
    // `AssignFamilyModal.tsx`'s own write-in offer is
    // `disabled={isSaving || !peopleValid}`. This card's Save used to be
    // `disabled={isSaving}` alone — narrower than it looked, since Save is
    // `type="submit"` in a real `<form>` and the field's own `min=1 step=1`
    // blocks a click with a native bubble. The genuinely silent path is
    // Enter inside the field, pinned separately below.
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onEdit={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '0' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('refuses Enter from an invalid People field exactly as Save does — no signal, but no save', () => {
    // Native form submission never fires here: `fireEvent.keyDown` in jsdom
    // does not trigger implicit submission, so this exercises the field's
    // own `onKeyDown` — `preventDefault()` then `trySubmit()` — which is the
    // path a disabled Save button does nothing to protect on its own.
    // `trySubmit`'s existing `!peopleValid` guard is what actually stops the
    // write; this pins it at the one call site the Save-button gate above
    // cannot reach.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '0' } })
    fireEvent.keyDown(screen.getByLabelText('People'), { key: 'Enter' })

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('refuses to save when the field sanitised away unparseable text, even though it now reads blank (kindred#2540 fix-round BLOCKER 4)', () => {
    // `<input type="number">` sanitises `abc` to `''`, so `people === ''`
    // reads exactly like a genuinely blank field -- which is VALID (owner
    // ruling 2026-08-21: blank means wholesale). Without `validity.badInput`
    // the button re-enables and a value the staff member believes they typed
    // saves as something else (an unsized write-in) instead of refusing.
    //
    // jsdom does not implement per-keystroke `badInput` tracking for number
    // inputs (verified against this exact component: neither
    // `fireEvent.change` nor `userEvent.type` ever sets it), so this
    // overrides the read-only `validity` accessor for one dispatch -- the
    // only way to get the real signal a browser sends onto the event this
    // handler actually receives, rather than asserting on React state alone.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: 3 }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    const people = screen.getByLabelText('People')

    const original = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'validity')
    Object.defineProperty(window.HTMLInputElement.prototype, 'validity', {
      configurable: true,
      get: () => ({ badInput: true }) as ValidityState,
    })
    try {
      // The field already reads `3` (seeded from `occupant.partySize`), so
      // this is a real edit -- not the untouched, still-blank field a `''`
      // dispatch would be indistinguishable from.
      fireEvent.change(people, { target: { value: '' } })
    } finally {
      if (original) Object.defineProperty(window.HTMLInputElement.prototype, 'validity', original)
    }

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('refuses bad input typed straight into an ALREADY-BLANK field, where the string never changes (kindred#2540 validation-fix, Q1)', () => {
    // Every production write-in row is unsized, so every pencil edit opens
    // with a blank People field -- this is the field's EVERYDAY entry point,
    // not a corner case. `<input type="number">` sanitises unparseable text
    // to `''`, indistinguishable by the string alone from a field nobody
    // touched. Because the string never changes, React's own dedup
    // (`getInstIfValueChanged` -> `updateValueIfChanged`) never invokes
    // `onChange` at all: `peopleBadInput`, set ONLY inside `onChange`, never
    // gets the signal, and the Save button stays enabled on a value the
    // staff member believes they typed.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: null }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    const people = screen.getByLabelText('People')
    expect(people).toHaveValue(null) // genuinely untouched, not a prior edit

    const original = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'validity')
    Object.defineProperty(window.HTMLInputElement.prototype, 'validity', {
      configurable: true,
      get: () => ({ badInput: true }) as ValidityState,
    })
    try {
      // The SAME string the field already holds -- no change, exactly as a
      // real browser's sanitisation leaves an already-blank field.
      fireEvent.change(people, { target: { value: '' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    } finally {
      if (original) Object.defineProperty(window.HTMLInputElement.prototype, 'validity', original)
    }

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('accepts blank again once a caught bad edit is cleared back to genuinely blank (kindred#2540 validation-fix, Q2)', () => {
    // The mirror image of the case above. A real bad edit (from the seeded
    // `3`) is caught correctly via `onChange`, exactly like "refuses to save
    // when the field sanitised away unparseable text" above. Backspacing
    // FURTHER, past that point, to a genuinely blank field is -- again -- a
    // `'' -> ''` no-op that fires no `onChange`, so an implementation that
    // only reads state captured at `onChange` time leaves `true` stuck
    // forever. Blank is a COMPLETE answer (wholesale) and must always be
    // accepted, so this exercises the one path a stuck-disabled Save does not
    // block: Enter inside the field itself, which calls `trySubmit` directly.
    const onEdit = vi.fn()
    render(
      <WriteInCard occupant={{ name: 'Liam Garcia', note: '', partySize: 3 }} onEdit={onEdit} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    const people = screen.getByLabelText('People')

    const original = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'validity')
    Object.defineProperty(window.HTMLInputElement.prototype, 'validity', {
      configurable: true,
      get: () => ({ badInput: true }) as ValidityState,
    })
    try {
      fireEvent.change(people, { target: { value: '' } }) // caught, as above
    } finally {
      if (original) Object.defineProperty(window.HTMLInputElement.prototype, 'validity', original)
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    Object.defineProperty(window.HTMLInputElement.prototype, 'validity', {
      configurable: true,
      get: () => ({ badInput: false }) as ValidityState,
    })
    try {
      // Same string, `'' -> ''`, no change -- the field is now genuinely
      // blank and no `onChange` fires to say so.
      fireEvent.change(people, { target: { value: '' } })
      fireEvent.keyDown(people, { key: 'Enter' })
    } finally {
      if (original) Object.defineProperty(window.HTMLInputElement.prototype, 'validity', original)
    }

    expect(onEdit).toHaveBeenCalledWith({
      occupantName: 'Liam Garcia',
      reason: '',
      partySize: null,
    })
  })
})

describe('the "Written in at …" footer', () => {
  /*
   * DELETED TWICE, and the second time is the one that sticks.
   *
   * kindred#2381 struck it: it existed to say the row lives on a different
   * unit than the card drawing it, which mattered only because a merged card
   * showed ONE write-in and hid the rest, sending staff to look for the Clear
   * on a card the merge had taken away. Every write-in is drawn now, each with
   * its own removal.
   *
   * Review then RESTORED it on an identity argument — four occupants in one
   * merged well sleep in four rooms. The owner struck it again on 2026-08-18,
   * and the argument against is that the identity claim is true of FAMILIES in
   * that well too, and this line said nothing about them. A merged card that
   * explains its write-ins' rooms while staying silent about its families' is
   * worse than one that explains neither. The room dimension belongs to one
   * shorthand covering every occupant — kindred#2458 — and this footer was a
   * half-built version of it.
   */
  it('is not printed, on an inherited row or any other', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '', partySize: null }}
        onRemove={() => undefined}
      />
    )

    expect(screen.queryByText(/written in at/i)).not.toBeInTheDocument()
  })
})
