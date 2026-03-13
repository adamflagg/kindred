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

  it('renders waitlisted badge with amber colors', () => {
    render(<StatusBadge status="waitlisted" />)
    const badge = screen.getByText('Waitlisted')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-amber-100')
  })

  it('renders cancelled badge with red colors', () => {
    render(<StatusBadge status="cancelled" />)
    const badge = screen.getByText('Cancelled')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-red-100')
  })

  it('renders dismissed badge with red colors', () => {
    render(<StatusBadge status="dismissed" />)
    const badge = screen.getByText('Dismissed')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-red-100')
  })

  it('renders left_early badge with orange colors', () => {
    render(<StatusBadge status="left_early" />)
    const badge = screen.getByText('Left Early')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-orange-100')
  })

  it('renders applied badge with blue colors', () => {
    render(<StatusBadge status="applied" />)
    const badge = screen.getByText('Applied')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-blue-100')
  })

  it('renders withdrawn badge with stone colors', () => {
    render(<StatusBadge status="withdrawn" />)
    const badge = screen.getByText('Withdrawn')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-stone-100')
  })

  it('renders unknown status with stone colors', () => {
    render(<StatusBadge status="unknown" />)
    const badge = screen.getByText('Unknown')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('bg-stone-100')
  })

  it('uses pill styling with rounded-full', () => {
    render(<StatusBadge status="waitlisted" />)
    const badge = screen.getByText('Waitlisted')
    expect(badge.className).toContain('rounded-full')
    expect(badge.className).toContain('text-xs')
    expect(badge.className).toContain('font-medium')
  })
})
