/**
 * SeasonEmptyState — what every Analytics page shows while the viewed season has no countable
 * summer rows (PR 4, board 9 option A, owner 2026-10-14). One line, a link to the prior season,
 * and an optional second line naming the priority date. No icon, no banner, no big number.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SeasonEmptyState } from './SeasonEmptyState'

describe('SeasonEmptyState', () => {
  it('says the season has no enrollments yet and links to the prior season', () => {
    render(<SeasonEmptyState year={2027} prior={2026} neverSynced={false} onViewPrior={vi.fn()} />)
    expect(screen.getByText(/No enrollments yet for 2027/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'view 2026' })).toBeInTheDocument()
  })

  it('says the season has not synced yet when its enrollment sync never ran', () => {
    render(<SeasonEmptyState year={2027} prior={2026} neverSynced onViewPrior={vi.fn()} />)
    expect(screen.getByText(/2027 hasn.t synced from CampMinder yet/)).toBeInTheDocument()
    expect(screen.queryByText(/No enrollments yet/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'view 2026' })).toBeInTheDocument()
  })

  it('calls onViewPrior when the link is clicked', () => {
    const onViewPrior = vi.fn()
    render(
      <SeasonEmptyState year={2027} prior={2026} neverSynced={false} onViewPrior={onViewPrior} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'view 2026' }))
    expect(onViewPrior).toHaveBeenCalledTimes(1)
  })

  it('names the priority date on a second line when it is configured and still ahead', () => {
    render(
      <SeasonEmptyState
        year={2027}
        prior={2026}
        neverSynced={false}
        priorityDate="2026-11-11"
        today={new Date(2026, 9, 26)}
        onViewPrior={vi.fn()}
      />
    )
    expect(screen.getByText('Priority registration opens Wednesday, Nov 11.')).toBeInTheDocument()
  })

  it('shows the priority line on the day itself', () => {
    render(
      <SeasonEmptyState
        year={2027}
        prior={2026}
        neverSynced={false}
        priorityDate="2026-11-11"
        today={new Date(2026, 10, 11, 15, 0)}
        onViewPrior={vi.fn()}
      />
    )
    expect(screen.getByText(/Priority registration opens/)).toBeInTheDocument()
  })

  it('drops the priority line once the date has passed ("opens" would be wrong)', () => {
    render(
      <SeasonEmptyState
        year={2027}
        prior={2026}
        neverSynced={false}
        priorityDate="2026-11-11"
        today={new Date(2026, 10, 12)}
        onViewPrior={vi.fn()}
      />
    )
    expect(screen.queryByText(/Priority registration/)).not.toBeInTheDocument()
  })

  it('has no second line when no priority date is configured', () => {
    render(<SeasonEmptyState year={2027} prior={2026} neverSynced={false} onViewPrior={vi.fn()} />)
    expect(screen.queryByText(/Priority registration/)).not.toBeInTheDocument()
  })

  it('uses the mock’s card markup (board 9: card-lodge, centred, one semibold line)', () => {
    const { container } = render(
      <SeasonEmptyState year={2027} prior={2026} neverSynced={false} onViewPrior={vi.fn()} />
    )
    const card = container.firstElementChild
    expect(card).toHaveClass('card-lodge', 'px-6', 'py-8', 'text-center')
    expect(screen.getByText(/No enrollments yet/).closest('p')).toHaveClass(
      'text-foreground',
      'text-base',
      'font-semibold'
    )
  })
})
