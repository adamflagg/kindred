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

  // kit CF.notes: `.cf-notes li > .n { min-width: 12px }`, so every note's words start at one x.
  it('gives each number a 12px minimum so the words line up', () => {
    render(<DefinitionNotes notes={[{ n: 1, text: 'Posted: locked.' }]} />)
    expect(screen.getByText('1.')).toHaveClass('min-w-3')
  })

  // The Rounds mock bolds a second term inside a note ("… Accepted sits inside Posted").
  it('bolds the first use of each alsoBold term after the lead term', () => {
    render(
      <DefinitionNotes
        alsoBold={['Accepted', 'Not yet confirmed:']}
        notes={[
          {
            n: 1,
            term: 'Committed',
            text: 'Committed: what Remaining takes away. Accepted sits inside Posted. Accepted again.',
          },
          {
            n: 2,
            term: 'Posted',
            text: 'Posted: locked. Not yet confirmed: the part CampMinder lacks.',
          },
        ]}
      />
    )
    const [first, second] = screen.getAllByRole('listitem')
    expect([...first!.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
      'Committed:',
      'Accepted',
    ])
    expect(first).toHaveTextContent(
      '1. Committed: what Remaining takes away. Accepted sits inside Posted. Accepted again.'
    )
    expect([...second!.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
      'Posted:',
      'Not yet confirmed:',
    ])
  })

  // Design language §12 (kit CF.notes): the term leads in bold, the words follow.
  it("sets a note's term in bold when it carries one", () => {
    render(<DefinitionNotes notes={[{ n: 1, term: 'Locked', text: 'Locked: in effect.' }]} />)
    const term = screen.getByText('Locked:')
    expect(term.tagName).toBe('B')
    expect(screen.getByRole('listitem')).toHaveTextContent('1. Locked: in effect.')
  })

  it('sets a term bold when a comma or an equals sign follows it, and never a word that only starts the same', () => {
    render(
      <DefinitionNotes
        notes={[
          {
            n: 1,
            term: 'Small groups show as they are',
            text: 'Small groups show as they are, dollars included.',
          },
          { n: 2, term: 'Remaining', text: 'Remaining = Allocated − Posted.' },
          { n: 3, term: 'Share', text: 'Shares are kept.' },
        ]}
      />
    )
    expect(screen.getByText('Small groups show as they are').tagName).toBe('B')
    expect(screen.getByText('Remaining').tagName).toBe('B')
    expect(screen.queryByText('Share')).toBeNull()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      '1. Small groups show as they are, dollars included.'
    )
  })

  // money-grants.html: "<b>Cancelled</b> (⊘ before a name): …", the term alone in bold, its aside plain.
  it('sets only the term bold when a parenthetical aside follows it', () => {
    render(
      <DefinitionNotes
        notes={[
          { n: 1, term: 'Cancelled', text: 'Cancelled (⊘ before a name): from the enrollment.' },
        ]}
      />
    )
    expect(screen.getByText('Cancelled').tagName).toBe('B')
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      '1. Cancelled (⊘ before a name): from the enrollment.'
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
    expect(mark).toHaveClass('text-[0.72em]', 'leading-[0]', 'font-medium', 'align-super')
    expect(mark).not.toHaveClass('text-xs')
    expect(mark).toHaveAttribute('title', 'Awarded: posted amounts, net of reversals.')
    expect(mark).toHaveClass('tabular-nums', 'cursor-help')
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

// Requests' mock bolds each note's term ("Decided: …"); no other mock does, so it is opt-in.
describe('DefinitionNotes boldTerm', () => {
  const notes = [{ n: 1, text: 'Decided: the award for a round.' }]

  it('bolds the leading term when asked', () => {
    render(<DefinitionNotes notes={notes} boldTerm />)
    const term = screen.getByText('Decided:')
    expect(term.tagName).toBe('B')
    expect(screen.getByRole('listitem')).toHaveTextContent('1. Decided: the award for a round.')
  })

  it('leaves the words plain by default', () => {
    render(<DefinitionNotes notes={notes} />)
    expect(document.querySelector('b')).toBeNull()
  })
})

// ux3 to-place-14: the mock's `.cf-notes li > .n` is flex none, min-width 12px, so the terms align from note 10 on.
describe('DefinitionNotes number', () => {
  it('holds a 12px minimum width and never shrinks', () => {
    render(<DefinitionNotes notes={[{ n: 1, text: 'Decided: the award.' }]} />)
    const number = screen.getByRole('listitem').querySelector('span')
    expect(number).toHaveTextContent('1.')
    expect(number).toHaveClass('flex-none', 'min-w-3')
  })
})

describe('DefinitionNotes: extra bold terms (ux3 statistics-7)', () => {
  it('sets each also-bold term in bold at its first occurrence only, beside the lead term', () => {
    render(
      <DefinitionNotes
        notes={[
          {
            n: 1,
            term: 'Awarded',
            text: 'Awarded: Posted, net of clawbacks. Awards counts requests above $0; more Awards follow.',
            alsoBold: ['Awards'],
          },
        ]}
      />
    )
    const bolds = [...document.querySelectorAll('b')].map((b) => b.textContent)
    expect(bolds).toEqual(['Awarded:', 'Awards'])
    expect(screen.getByRole('listitem')).toHaveTextContent(
      '1. Awarded: Posted, net of clawbacks. Awards counts requests above $0; more Awards follow.'
    )
  })

  it('bolds a term with symbols in it (R2 max fee %), and leaves a note with none alone', () => {
    render(
      <DefinitionNotes
        notes={[
          {
            n: 1,
            term: 'Appeals',
            text: 'Appeals: ask again; appeal rate = a ÷ b. R2 max fee % is a rules value.',
            alsoBold: ['appeal rate', 'R2 max fee %'],
          },
          { n: 2, term: 'Apps', text: 'Apps: every request.' },
        ]}
      />
    )
    expect([...document.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
      'Appeals:',
      'appeal rate',
      'R2 max fee %',
      'Apps:',
    ])
  })
})
