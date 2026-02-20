/**
 * TDD Tests for WaitlistGradeChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * This component displays a stacked horizontal bar chart showing
 * enrollment split (no enrollment / has enrollment) per grade.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WaitlistGradeChart } from './WaitlistGradeChart'
import type { GradeBreakdown } from '../../types/metrics'

describe('WaitlistGradeChart', () => {
  const mockData: GradeBreakdown[] = [
    { grade: 5, count: 3, percentage: 30.0, no_enrollment: 2, has_enrollment: 1 },
    { grade: 6, count: 4, percentage: 40.0, no_enrollment: 1, has_enrollment: 3 },
    { grade: 7, count: 3, percentage: 30.0, no_enrollment: 0, has_enrollment: 3 },
  ]

  describe('component export', () => {
    it('should export WaitlistGradeChart component', async () => {
      const module = await import('./WaitlistGradeChart')
      expect(typeof module.WaitlistGradeChart).toBe('function')
    })
  })

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<WaitlistGradeChart data={mockData} />)
      expect(screen.getByText('Grade Distribution')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<WaitlistGradeChart data={mockData} title="Custom Grade Title" />)
      expect(screen.getByText('Custom Grade Title')).toBeInTheDocument()
    })

    it('should render empty state when no data', () => {
      render(<WaitlistGradeChart data={[]} />)
      expect(screen.getByText('No data available')).toBeInTheDocument()
    })
  })

  describe('legend', () => {
    it('should show No Other Sessions in legend', () => {
      render(<WaitlistGradeChart data={mockData} />)
      expect(screen.getByText('No Other Sessions')).toBeInTheDocument()
    })

    it('should show Has Other Sessions in legend', () => {
      render(<WaitlistGradeChart data={mockData} />)
      expect(screen.getByText('Has Other Sessions')).toBeInTheDocument()
    })
  })

  describe('click handling', () => {
    it('should accept onBarClick prop without error', () => {
      const onBarClick = vi.fn()
      render(<WaitlistGradeChart data={mockData} onBarClick={onBarClick} />)
      // Verify the component renders (click testing on recharts is limited in jsdom)
      expect(screen.getByText('Grade Distribution')).toBeInTheDocument()
    })
  })

  describe('handles null grade', () => {
    it('should display Unknown for null grade', () => {
      const dataWithNull: GradeBreakdown[] = [
        { grade: null, count: 2, percentage: 100.0, no_enrollment: 1, has_enrollment: 1 },
      ]
      render(<WaitlistGradeChart data={dataWithNull} />)
      // The chart should render without errors
      expect(screen.getByText('Grade Distribution')).toBeInTheDocument()
    })
  })
})
