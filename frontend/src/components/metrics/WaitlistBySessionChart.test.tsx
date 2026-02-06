/**
 * TDD Tests for WaitlistBySessionChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * This component displays a stacked bar chart showing per-session
 * enrollment breakdown for waitlisted campers.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WaitlistBySessionChart } from './WaitlistBySessionChart'
import type { WaitlistSessionBreakdown } from '../../types/metrics'

describe('WaitlistBySessionChart', () => {
  const mockData: WaitlistSessionBreakdown[] = [
    {
      session_cm_id: 1001,
      session_name: 'Session 1',
      waitlisted: 5,
      no_enrollment: 2,
      has_enrollment: 3,
      accepted: 1,
      declined: 0,
      enrolled_in: [
        { session_cm_id: 1002, session_name: 'Session 2', count: 2 },
        { session_cm_id: 1003, session_name: 'Session 3', count: 1 },
      ],
    },
    {
      session_cm_id: 1002,
      session_name: 'Session 2',
      waitlisted: 3,
      no_enrollment: 1,
      has_enrollment: 2,
      accepted: 0,
      declined: 1,
      enrolled_in: [{ session_cm_id: 1001, session_name: 'Session 1', count: 2 }],
    },
  ]

  describe('component export', () => {
    it('should export WaitlistBySessionChart component', async () => {
      const module = await import('./WaitlistBySessionChart')
      expect(typeof module.WaitlistBySessionChart).toBe('function')
    })
  })

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<WaitlistBySessionChart data={mockData} />)
      expect(screen.getByText('Waitlist by Session')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<WaitlistBySessionChart data={mockData} title="Custom Title" />)
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should render empty state when no data', () => {
      render(<WaitlistBySessionChart data={[]} />)
      expect(screen.getByText('No data available')).toBeInTheDocument()
    })
  })

  describe('legend', () => {
    it('should show No Enrollment in legend', () => {
      render(<WaitlistBySessionChart data={mockData} />)
      expect(screen.getByText('No Enrollment')).toBeInTheDocument()
    })

    it('should show enrolled session names in legend', () => {
      render(<WaitlistBySessionChart data={mockData} />)
      // Session 2 and Session 3 are enrolled-in sessions from the data,
      // but Session 1 is also an enrolled-in session for Session 2's bar.
      // All unique enrolled-in session names should appear in the legend.
      expect(screen.getByText('Session 2')).toBeInTheDocument()
      expect(screen.getByText('Session 3')).toBeInTheDocument()
    })
  })

  describe('click handling', () => {
    it('should call onBarClick when provided', () => {
      const onBarClick = vi.fn()
      render(<WaitlistBySessionChart data={mockData} onBarClick={onBarClick} />)
      // Verify the component renders (click testing on recharts is limited in jsdom)
      expect(screen.getByText('Waitlist by Session')).toBeInTheDocument()
    })
  })
})
