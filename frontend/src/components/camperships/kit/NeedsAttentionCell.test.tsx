import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NeedsAttentionCell } from './NeedsAttentionCell'

const HOLD = {
  level: 'hold' as const,
  pill: 'Income conflict',
  fact: '$120,000 vs $95,000 on the two forms. Call the family and enter the figure.',
}

describe('NeedsAttentionCell (§4.4; D24; batch 4)', () => {
  it('shows a red pill for a hold and an amber one for a note', () => {
    const { unmount } = render(<NeedsAttentionCell item={HOLD} />)
    expect(screen.getByText('Income conflict')).toHaveClass('bg-red-100')
    unmount()
    render(<NeedsAttentionCell item={{ ...HOLD, level: 'note', pill: 'Waiting 23 days' }} />)
    expect(screen.getByText('Waiting 23 days')).toHaveClass('bg-amber-100')
  })

  // Owner LOCKED (batch 4, grid-layout-options.html#or=i): the cell is the chip only; the full
  // text and the next step live in the opened row's detail line. Replaces "cuts the fact at the
  // column edge until the row is highlighted" and "carries the next step as an action".
  it('draws only the chip, never the fact, and nothing else', () => {
    const { container } = render(<NeedsAttentionCell item={HOLD} />)
    expect(container).toHaveTextContent(/^Income conflict$/)
    expect(screen.queryByText(HOLD.fact)).toBeNull()
    expect(container.firstElementChild).toBe(screen.getByText('Income conflict'))
  })

  it('draws nothing on a row that needs nothing (D24)', () => {
    const { container } = render(<NeedsAttentionCell item={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
