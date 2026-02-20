/**
 * TDD Tests for WaitlistGenderChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * This component displays a nested donut chart showing gender breakdown
 * with enrollment split (inner ring: gender totals, outer ring: enrollment status).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WaitlistGenderChart } from './WaitlistGenderChart'
import type { GenderBreakdown } from '../../types/metrics'

describe('WaitlistGenderChart', () => {
  const mockData: GenderBreakdown[] = [
    { gender: 'F', count: 5, percentage: 50.0, no_enrollment: 3, has_enrollment: 2 },
    { gender: 'M', count: 4, percentage: 40.0, no_enrollment: 1, has_enrollment: 3 },
    { gender: 'Unknown', count: 1, percentage: 10.0, no_enrollment: 1, has_enrollment: 0 },
  ]

  describe('component export', () => {
    it('should export WaitlistGenderChart component', async () => {
      const module = await import('./WaitlistGenderChart')
      expect(typeof module.WaitlistGenderChart).toBe('function')
    })
  })

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<WaitlistGenderChart data={mockData} />)
      expect(screen.getByText('Gender Distribution')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<WaitlistGenderChart data={mockData} title="Custom Gender Title" />)
      expect(screen.getByText('Custom Gender Title')).toBeInTheDocument()
    })

    it('should render empty state when no data', () => {
      render(<WaitlistGenderChart data={[]} />)
      expect(screen.getByText('No data available')).toBeInTheDocument()
    })
  })

  describe('legend', () => {
    it('should show gender labels in legend', () => {
      render(<WaitlistGenderChart data={mockData} />)
      // Legend should show gender labels
      expect(screen.getByText('F')).toBeInTheDocument()
      expect(screen.getByText('M')).toBeInTheDocument()
    })

    it('should show enrollment status meaning in legend', () => {
      render(<WaitlistGenderChart data={mockData} />)
      expect(screen.getByText('No Other Sessions')).toBeInTheDocument()
      expect(screen.getByText('Has Other Sessions')).toBeInTheDocument()
    })
  })

  describe('click handling', () => {
    it('should accept onSegmentClick prop without error', () => {
      const onSegmentClick = vi.fn()
      render(<WaitlistGenderChart data={mockData} onSegmentClick={onSegmentClick} />)
      expect(screen.getByText('Gender Distribution')).toBeInTheDocument()
    })
  })

  describe('handles single gender', () => {
    it('should render with only one gender', () => {
      const singleGender: GenderBreakdown[] = [
        { gender: 'F', count: 5, percentage: 100.0, no_enrollment: 2, has_enrollment: 3 },
      ]
      render(<WaitlistGenderChart data={singleGender} />)
      expect(screen.getByText('Gender Distribution')).toBeInTheDocument()
    })
  })
})
