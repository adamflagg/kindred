import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders nothing for enrolled status', () => {
    const { container } = render(<StatusBadge status="enrolled" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for undefined status', () => {
    const { container } = render(<StatusBadge status={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it.each([
    { status: 'waitlisted', label: 'Waitlisted', color: 'bg-amber-100' },
    { status: 'cancelled', label: 'Cancelled', color: 'bg-red-100' },
    { status: 'dismissed', label: 'Dismissed', color: 'bg-red-100' },
    { status: 'left_early', label: 'Left Early', color: 'bg-orange-100' },
    { status: 'applied', label: 'Applied', color: 'bg-blue-100' },
    { status: 'withdrawn', label: 'Withdrawn', color: 'bg-stone-100' },
    { status: 'incomplete', label: 'Incomplete', color: 'bg-stone-100' },
    { status: 'none', label: 'No Status', color: 'bg-stone-100' },
    { status: 'unknown', label: 'Unknown', color: 'bg-stone-100' },
  ])('renders $status as "$label" with $color', ({ status, label, color }) => {
    render(<StatusBadge status={status} />)
    const badge = screen.getByText(label)
    expect(badge).toBeDefined()
    expect(badge.className).toContain(color)
  })
})
