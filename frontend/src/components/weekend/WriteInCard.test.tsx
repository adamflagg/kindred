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
    render(<WriteInCard occupant={{ name: 'Emma Johnson', note: '' }} />)

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('carries the note INSIDE the card, describing the occupant rather than the room', () => {
    render(<WriteInCard occupant={{ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' }} />)

    expect(screen.getByText('Kitchen lead, Fri–Sun')).toBeInTheDocument()
  })

  it('says so plainly when nobody named the occupant', () => {
    // Reachable from a row written before 1500000148 with an empty note, or
    // through the permissive write schema. The room is still closed, so an
    // EMPTY card would read as an open room the board refuses drops on.
    render(<WriteInCard occupant={{ name: '', note: '' }} />)

    expect(screen.getByText('Occupant not named')).toBeInTheDocument()
  })

  it('renders no note row at all when there is none', () => {
    // The note ships EMPTY on every historical row by construction, so this is
    // the common case rather than the edge one.
    const { container } = render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} />)

    expect(container.textContent).toBe('Liam Garcia')
  })

  it('does NOT mark itself as a family card', () => {
    // `FamilyCard` sets `data-family-card` and board code queries that selector
    // to find PLACED parties. A write-in is an occupant, not a placement: a
    // card carrying the attribute would be counted as a family in a room no
    // family is in.
    const { container } = render(<WriteInCard occupant={{ name: 'Emma Johnson', note: '' }} />)

    expect(container.querySelector('[data-family-card]')).toBeNull()
  })

  it('is not draggable, and the CARD itself is never a button', () => {
    // `FamilyCard` is a `<button>` that opens the family panel and a dnd-kit
    // draggable. There is no panel behind a write-in and nowhere to drag it —
    // a card that looks interactive and is not is worse than plain text. The
    // corner control below is a real button; the card body stays inert.
    const { container } = render(<WriteInCard occupant={{ name: 'Emma Johnson', note: '' }} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })

  it('wraps a long occupant name instead of truncating it (kindred#2431)', () => {
    // Owner ruling, 2026-08-18: WRAP, following the #2253 precedent — a
    // truncated name is not a shorter name, it is a different one, and two
    // write-ins sharing a prefix would render identically.
    render(<WriteInCard occupant={{ name: 'Alexandra Vandenberg-Okonkwo', note: '' }} />)

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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the occupant it would remove, so four of them are four questions', () => {
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onRemove={() => undefined} />)

    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeInTheDocument()
  })

  it('still offers a removal for a write-in nobody named', () => {
    render(<WriteInCard occupant={{ name: '', note: '' }} onRemove={() => undefined} />)

    expect(
      screen.getByRole('button', { name: 'Remove write-in Occupant not named' })
    ).toBeInTheDocument()
  })

  it('calls back exactly once, with no argument to get wrong', () => {
    // The CARD knows which row it draws; the caller binds the target. Passing
    // an id up from here would be a second place that has to agree about
    // which of the four rows this card is.
    const onRemove = vi.fn()
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('is disabled while a write to this row is in flight', () => {
    // RENAMED from `isRemoving` (kindred#2430): the flag now gates the edit
    // pencil too, since both controls write the same row.
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '' }}
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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} />)

    expect(screen.queryByRole('button', { name: /edit write-in/i })).not.toBeInTheDocument()
  })

  it('renders beside the X with no hover-only class — ALWAYS visible', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '' }}
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
    render(<WriteInCard occupant={{ name: '', note: '' }} onEdit={() => undefined} />)

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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onEdit={() => undefined} />)

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
        occupant={{ name: 'Liam Garcia', note: 'Kitchen lead, Fri–Sun' }}
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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onEdit={onEdit} />)

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
    })
    expect(screen.queryByRole('textbox', { name: 'Occupant' })).not.toBeInTheDocument()
  })

  it('refuses an empty occupant name, the same guard the write-in prompt uses', () => {
    const onEdit = vi.fn()
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Occupant' })).toBeInTheDocument()
  })

  it('lets Cancel close the form without writing anything', () => {
    const onEdit = vi.fn()
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onEdit={onEdit} />)

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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onEdit={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupant' }), {
      target: { value: 'Abandoned Draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit write-in Liam Garcia' }))

    expect(screen.getByRole('textbox', { name: 'Occupant' })).toHaveValue('Liam Garcia')
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
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onRemove={() => undefined} />)

    expect(screen.queryByText(/written in at/i)).not.toBeInTheDocument()
  })
})
