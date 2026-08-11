/**
 * The occupant card a write-in draws in the unit's well — kindred#2078.
 *
 * Fictional data throughout.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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

  it('is not draggable and is not a button', () => {
    // `FamilyCard` is a `<button>` that opens the family panel and a dnd-kit
    // draggable. There is no panel behind a write-in and nowhere to drag it —
    // a control that looks interactive and is not is worse than plain text.
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

describe('a write-in the card INHERITED from elsewhere in the tree', () => {
  /*
   * The row names one unit; it closes a SPACE. Split a written-into building
   * and its rooms carry the occupant; merge over a written-into room and the
   * building does. Printing the name alone on the inheriting card would say
   * this room's own row names them — and staff would go looking on a card that
   * no longer exists for the Clear that is right in front of them.
   */
  it('says which unit the write-in is recorded at', () => {
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} atUnitName="House" />)

    expect(screen.getByText('Written in at House')).toBeInTheDocument()
  })

  it('says nothing extra when the row is the card’s own', () => {
    // The overwhelmingly common case, and the one that must stay quiet: a line
    // on every written-into card restating the card's own name is chrome.
    render(<WriteInCard occupant={{ name: 'Liam Garcia', note: '' }} />)

    expect(screen.queryByText(/written in at/i)).not.toBeInTheDocument()
  })
})
