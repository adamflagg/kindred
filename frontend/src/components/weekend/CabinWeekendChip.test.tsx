/**
 * The board's stats-bar cabin-weekend chip (Home 1, kindred#2648 UI half).
 * Q2/Q3 in the approved design: a pill chip, amber tone, that opens the
 * detail view on click.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CabinWeekendChip } from './CabinWeekendChip'

describe('CabinWeekendChip', () => {
  it('renders nothing when there is nothing waiting on this weekend', () => {
    const { container } = render(<CabinWeekendChip count={0} onClick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('states the count in the chip text', () => {
    render(<CabinWeekendChip count={4} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /4 cabins need a weekend/i })).toBeInTheDocument()
  })

  it('uses the singular for exactly one', () => {
    render(<CabinWeekendChip count={1} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /1 cabin needs a weekend/i })).toBeInTheDocument()
  })

  it('opens the detail view on click', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<CabinWeekendChip count={2} onClick={onClick} />)

    await user.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
