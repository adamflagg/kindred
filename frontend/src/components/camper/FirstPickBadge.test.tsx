import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import FirstPickBadge from './FirstPickBadge'

describe('FirstPickBadge', () => {
  it('renders nothing when isFirstRequested is false', () => {
    const { container } = render(<FirstPickBadge isFirstRequested={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a "1" badge with the First pick accessible label when true', () => {
    render(<FirstPickBadge isFirstRequested={true} />)
    const badge = screen.getByLabelText('First pick')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('1')
  })
})
