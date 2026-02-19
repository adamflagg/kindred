/**
 * TDD Tests for BunkStaffTooltip component.
 *
 * Tests written FIRST before implementation.
 * Portal-based tooltip showing staff assigned to a specific session+bunk cell.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { BunkStaffInfo } from '../../hooks/useBunkStaff'
import { BunkStaffTooltip } from './BunkStaffTooltip'

const sampleStaff: BunkStaffInfo[] = [
  { name: 'Emma Johnson', personId: '12345' },
  { name: 'Liam Garcia', personId: '67890' },
]

describe('BunkStaffTooltip', () => {
  it('renders nothing when isVisible is false', () => {
    const { container } = render(
      <BunkStaffTooltip
        bunkName="B-1"
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
      <BunkStaffTooltip
        bunkName="B-1"
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText('B-1')).toBeInTheDocument()
  })

  it('shows all staff names when visible', () => {
    render(
      <BunkStaffTooltip
        bunkName="G-3"
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('shows fallback message when no staff assigned', () => {
    render(
      <BunkStaffTooltip bunkName="B-2" staff={[]} isVisible={true} position={{ x: 100, y: 100 }} />
    )
    expect(screen.getByText(/no staff assigned/i)).toBeInTheDocument()
  })

  it('renders via portal to document.body', () => {
    render(
      <BunkStaffTooltip
        bunkName="B-1"
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 100, y: 100 }}
      />
    )
    const tooltip = screen.getByText('B-1').closest('[data-tooltip="bunk-staff"]')
    expect(tooltip).toBeTruthy()
    expect(document.body.contains(tooltip)).toBe(true)
  })

  it('positions tooltip using fixed positioning', () => {
    render(
      <BunkStaffTooltip
        bunkName="B-1"
        staff={sampleStaff}
        isVisible={true}
        position={{ x: 200, y: 300 }}
      />
    )
    const tooltip = screen.getByText('B-1').closest('[data-tooltip="bunk-staff"]') as HTMLElement
    expect(tooltip).toBeTruthy()
    const style = tooltip.style
    expect(style.position).toBe('fixed')
  })
})
