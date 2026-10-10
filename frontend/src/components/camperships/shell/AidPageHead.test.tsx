import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AidPageHead } from './AidPageHead'

describe('AidPageHead (chrome-1: band, 4px, tabs)', () => {
  it('sits the band 4px over the tab row', () => {
    render(<AidPageHead band={<div>band</div>} tabs={<nav>tabs</nav>} />)
    const head = screen.getByTestId('aid-page-head')
    expect(head.firstElementChild).toHaveClass('mb-1')
    expect(head.firstElementChild).toHaveTextContent('band')
    expect(head.lastElementChild).toHaveTextContent('tabs')
  })

  it('leaves 2px under a band with no tab row, so the 10px page gap makes 12px to the strip', () => {
    render(<AidPageHead band={<div>band</div>} />)
    expect(screen.getByTestId('aid-page-head').firstElementChild).toHaveClass('mb-0.5')
  })
})
