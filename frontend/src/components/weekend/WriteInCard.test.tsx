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

  it('is disabled while the removal is in flight', () => {
    render(
      <WriteInCard
        occupant={{ name: 'Liam Garcia', note: '' }}
        onRemove={() => undefined}
        isRemoving
      />
    )

    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeDisabled()
  })
})

describe('the "Written in at …" footer', () => {
  /*
   * DELETED — kindred#2381. It existed to tell a reader that the row lives on
   * a different unit than the card drawing it, which mattered only because a
   * merged card showed ONE write-in and hid the rest: staff would go looking
   * for the Clear on a card the merge had taken away. Every write-in is drawn
   * now, and each carries its own removal, so the note says nothing the screen
   * does not.
   */
  it('is not printed, on an inherited row or any other', () => {
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} onRemove={() => undefined} />)

    expect(screen.queryByText(/written in at/i)).not.toBeInTheDocument()
  })
})
