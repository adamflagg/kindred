/**
 * TDD Tests for BunkCellTooltip component.
 *
 * Portal-based tooltip showing retention stats and optionally staff
 * assigned to a specific session+bunk cell.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { BunkStaffInfo } from '../../hooks/useBunkStaff'
import { BunkCellTooltip } from './BunkStaffTooltip'

const sampleStaff: BunkStaffInfo[] = [
  { name: 'Emma Johnson', personId: '12345' },
  { name: 'Liam Garcia', personId: '67890' },
]

const sampleRetention = { returnedCount: 8, baseCount: 10, rate: 0.8 }

describe('BunkCellTooltip', () => {
  it('renders nothing when isVisible is false', () => {
    const { container } = render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={sampleStaff}
        isVisible={false}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.queryByText('B-1')).not.toBeInTheDocument()
    expect(container.firstChild).toBeNull()
  })

  it('shows bunk name as heading when visible', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText('B-1')).toBeInTheDocument()
  })

  it('shows retention stats', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText(/8 of 10 returned/)).toBeInTheDocument()
    expect(screen.getByText(/80%/)).toBeInTheDocument()
  })

  it('shows staff names when staff provided', () => {
    render(
      <BunkCellTooltip
        bunkName="G-3"
        retention={sampleRetention}
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  it('does not show staff section when no staff provided', () => {
    render(
      <BunkCellTooltip
        bunkName="B-2"
        retention={sampleRetention}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    // Retention stats should still appear
    expect(screen.getByText(/8 of 10 returned/)).toBeInTheDocument()
    // No staff section
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })

  it('does not show staff section when staff array is empty', () => {
    render(
      <BunkCellTooltip
        bunkName="B-2"
        retention={sampleRetention}
        staff={[]}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText(/8 of 10 returned/)).toBeInTheDocument()
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })

  it('renders via portal to document.body', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    const tooltip = screen.getByText('B-1').closest('[data-tooltip="bunk-cell"]')
    expect(tooltip).toBeTruthy()
    expect(document.body.contains(tooltip)).toBe(true)
  })

  it('positions tooltip using fixed positioning', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 200, y: 300 }}
      />
    )
    const tooltip = screen.getByText('B-1').closest('[data-tooltip="bunk-cell"]') as HTMLElement
    expect(tooltip).toBeTruthy()
    const style = tooltip.style
    expect(style.position).toBe('fixed')
  })

  it('renders custom staffLabel when provided', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={sampleStaff}
        staffLabel="Co-Staff"
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText('Co-Staff')).toBeInTheDocument()
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })

  it('does not render staffLabel when no staff provided', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staffLabel="Co-Staff"
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.queryByText('Co-Staff')).not.toBeInTheDocument()
  })

  it('renders non-active staff with strikethrough styling', () => {
    const staffWithDismissed: BunkStaffInfo[] = [
      { name: 'Emma Johnson', personId: '12345', status: 'active' },
      { name: 'Liam Garcia', personId: '67890', status: 'dismissed' },
    ]

    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={staffWithDismissed}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )

    // Active staff renders normally
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    const emmaEl = screen.getByText('Emma Johnson')
    expect(emmaEl.classList.contains('line-through')).toBe(false)

    // Dismissed staff has strikethrough
    const liamEl = screen.getByText(/Liam Garcia/i).closest('li')
    expect(liamEl).toBeTruthy()
    expect(liamEl!.querySelector('.line-through')).toBeTruthy()
  })

  it('shows status label for non-active staff', () => {
    const staffWithResigned: BunkStaffInfo[] = [
      { name: 'Olivia Chen', personId: '11111', status: 'resigned' },
    ]

    render(
      <BunkCellTooltip
        bunkName="G-2"
        retention={sampleRetention}
        staff={staffWithResigned}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )

    expect(screen.getByText(/resigned/i)).toBeInTheDocument()
  })

  it('does not show status label for active staff', () => {
    const activeStaff: BunkStaffInfo[] = [
      { name: 'Emma Johnson', personId: '12345', status: 'active' },
    ]

    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={sampleRetention}
        staff={activeStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    // Should NOT show "active" as a status label
    expect(screen.queryByText('(active)')).not.toBeInTheDocument()
  })
})
