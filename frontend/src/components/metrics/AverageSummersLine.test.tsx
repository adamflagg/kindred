import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AverageSummersLine } from './AverageSummersLine'
import { TENURE_NOTES } from './tenureNotes'

describe('AverageSummersLine (D-UNCOVERED, decision 12)', () => {
  it('reads "Average N summers per camper, this one included." with the number bold to one decimal', () => {
    const { container } = render(<AverageSummersLine average={2.6129} />)
    expect(container.textContent).toBe('Average 2.6 summers per camper, this one included.3')
    expect(screen.getByText('2.6').tagName).toBe('B')
  })

  it('marks the line with note 3 (Overview: Cancelled is 1, age is 2) and no hover title', () => {
    const { container } = render(<AverageSummersLine average={3} />)
    const sup = container.querySelector('sup')
    expect(sup?.textContent).toBe('3')
    expect(sup?.hasAttribute('title')).toBe(false)
    expect(screen.getByText('3.0')).toBeInTheDocument()
  })

  it('renders nothing when there is no average', () => {
    const { container } = render(<AverageSummersLine average={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('note 3 says the figure is CampMinder Years at Camp and excludes Family Camp', () => {
    expect(TENURE_NOTES).toEqual([
      {
        n: 3,
        text: "From CampMinder's Years at Camp, which counts summer seasons and not Family Camp years.",
      },
    ])
  })
})
