import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NeedsAttentionCell } from './NeedsAttentionCell'

const HOLD = {
  level: 'hold' as const,
  pill: 'Income conflict',
  fact: '$120,000 vs $95,000 on the two forms. Call the family and enter the figure.',
}

describe('NeedsAttentionCell (§4.4; D24, D31)', () => {
  it('shows a red pill for a hold and an amber one for a note', () => {
    const { unmount } = render(<NeedsAttentionCell item={HOLD} highlighted={false} />)
    expect(screen.getByText('Income conflict')).toHaveClass('bg-red-100')
    unmount()
    render(
      <NeedsAttentionCell
        item={{ ...HOLD, level: 'note', pill: 'Waiting 23 days' }}
        highlighted={false}
      />
    )
    expect(screen.getByText('Waiting 23 days')).toHaveClass('bg-amber-100')
  })

  it('draws just the pill when there is no fact (O1)', () => {
    const { container } = render(
      <NeedsAttentionCell item={{ level: 'note', pill: 'Ask above cost', fact: '' }} highlighted />
    )
    expect(screen.getByText('Ask above cost')).toBeInTheDocument()
    expect(container.querySelectorAll('span.truncate, span.whitespace-normal')).toHaveLength(0)
  })

  it('cuts the fact at the column edge until the row is highlighted, never on hover', () => {
    const { rerender } = render(<NeedsAttentionCell item={HOLD} highlighted={false} />)
    expect(screen.getByText(HOLD.fact)).toHaveClass('truncate')
    rerender(<NeedsAttentionCell item={HOLD} highlighted />)
    expect(screen.getByText(HOLD.fact)).not.toHaveClass('truncate')
  })

  it('carries the next step as an action', () => {
    render(
      <NeedsAttentionCell
        item={HOLD}
        highlighted={false}
        action={<button type="button">Enter income</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Enter income' })).toBeInTheDocument()
  })

  it('draws nothing on a row that needs nothing (D24)', () => {
    const { container } = render(<NeedsAttentionCell item={null} highlighted={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
