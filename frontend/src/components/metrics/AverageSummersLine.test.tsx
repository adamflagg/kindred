import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AverageSummersLine } from './AverageSummersLine'
import { tenureNote, TENURE_NOTE_TEXT } from './tenureNotes'

describe('AverageSummersLine (D-UNCOVERED, decision 12)', () => {
  it('reads "Average N summers per camper, this one included." with the number bold to one decimal', () => {
    const { container } = render(<AverageSummersLine average={2.6129} note={3} />)
    expect(container.textContent).toBe('Average 2.6 summers per camper, this one included.3')
    expect(screen.getByText('2.6').tagName).toBe('B')
  })

  it('marks the line with the note number the page gives it, and no hover title', () => {
    const { container } = render(<AverageSummersLine average={3} note={3} />)
    const sup = container.querySelector('sup')
    expect(sup?.textContent).toBe('3')
    expect(sup?.hasAttribute('title')).toBe(false)
    expect(screen.getByText('3.0')).toBeInTheDocument()
  })

  it('renders nothing when there is no average', () => {
    const { container } = render(<AverageSummersLine average={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows no mark when the page gives no note number', () => {
    const { container } = render(<AverageSummersLine average={3} />)
    expect(container.querySelector('sup')).toBeNull()
  })

  it('the note says the figure is CampMinder Years at Camp and excludes Family Camp, numbered by the page', () => {
    expect(TENURE_NOTE_TEXT).toBe(
      "From CampMinder's Years at Camp, which counts summer seasons and not Family Camp years."
    )
    expect(tenureNote(2)).toEqual({ n: 2, text: TENURE_NOTE_TEXT })
  })
})
