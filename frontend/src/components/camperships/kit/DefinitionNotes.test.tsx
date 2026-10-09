import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DefRef, DefinitionNotes } from './DefinitionNotes'
import { NOTES_CAP, notesOverCap } from './notesCap'

describe('DefinitionNotes (§4.8; D20: numbered notes at the bottom, no hover)', () => {
  it('lists each note under its number', () => {
    render(
      <DefinitionNotes
        notes={[
          {
            n: 1,
            text: 'Decided: the award the dashboard computed or staff decided for the round.',
          },
          { n: 2, text: 'Posted: the round’s Posted check and the amount it locked.' },
        ]}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(
      '1. Decided: the award the dashboard computed or staff decided for the round.'
    )
  })

  it('draws nothing when a surface has no notes', () => {
    const { container } = render(<DefinitionNotes notes={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Design language §12: notes are 11.5/16 muted.
  it('sets the notes at 11.5px', () => {
    render(<DefinitionNotes notes={[{ n: 1, text: 'Budget: the first board-passed figure.' }]} />)
    expect(screen.getByRole('list')).toHaveClass('text-[11.5px]', 'leading-4')
  })

  it('marks a figure with its note number', () => {
    render(<DefRef n={2} />)
    expect(screen.getByText('2').tagName).toBe('SUP')
  })

  // Design language §12 (owner: "superscript footnote notes are too big font?"): 0.72em, raised,
  // weight 500, and a title target carrying the note's words.
  it('draws the mark at 0.72em, raised, with the note as its title', () => {
    render(<DefRef n={3} title="Awarded: posted amounts, net of reversals." />)
    const mark = screen.getByText('3')
    expect(mark).toHaveClass('text-[0.72em]', 'leading-none', 'font-medium', 'align-super')
    expect(mark).not.toHaveClass('text-xs')
    expect(mark).toHaveAttribute('title', 'Awarded: posted amounts, net of reversals.')
  })
})

// Design language §12 (owner: "way too many footer notes"): at most six numbered notes per page view.
describe('the notes cap', () => {
  const notes = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ n: i + 1, text: `Term ${String(i + 1)}: words.` }))

  it('is six', () => {
    expect(NOTES_CAP).toBe(6)
  })

  it('flags a list over the cap and passes one at or under it', () => {
    expect(notesOverCap(notes(6))).toBe(false)
    expect(notesOverCap(notes(7))).toBe(true)
  })
})
