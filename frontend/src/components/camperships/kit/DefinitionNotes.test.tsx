import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DefRef, DefinitionNotes } from './DefinitionNotes'

describe('DefinitionNotes (§4.8; D20: numbered notes at the bottom, no hover)', () => {
  it('lists each note under its number', () => {
    render(
      <DefinitionNotes
        notes={[
          { n: 1, text: 'Decided: the award Kindred computed or staff decided for the round.' },
          { n: 2, text: 'Posted: the round’s Posted tick and the amount it locked.' },
        ]}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(
      '1. Decided: the award Kindred computed or staff decided for the round.'
    )
  })

  it('draws nothing when a surface has no notes', () => {
    const { container } = render(<DefinitionNotes notes={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks a figure with its note number', () => {
    render(<DefRef n={2} />)
    expect(screen.getByText('2').tagName).toBe('SUP')
  })
})
