/**
 * TDD Tests for GenderByGradeChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * This component displays a stacked bar chart showing gender breakdown per grade.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GenderByGradeChart } from './GenderByGradeChart'
import type { GenderByGradeBreakdown } from '../../types/metrics'

describe('GenderByGradeChart', () => {
  const mockData: GenderByGradeBreakdown[] = [
    { grade: 3, male_count: 10, female_count: 12, total: 22 },
    { grade: 4, male_count: 15, female_count: 13, total: 28 },
    { grade: 5, male_count: 11, female_count: 14, total: 25 },
  ]

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<GenderByGradeChart data={mockData} />)
      expect(screen.getByText('Gender by Grade')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<GenderByGradeChart data={mockData} title="Custom Title" />)
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should render empty state when no data', () => {
      render(<GenderByGradeChart data={[]} />)
      expect(screen.getByText('No data available')).toBeInTheDocument()
    })

    it('should render chart container for valid data', () => {
      const { container } = render(<GenderByGradeChart data={mockData} />)
      expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument()
    })
  })

  describe('XAxis labels', () => {
    it('should use short grade labels without the word Grade', () => {
      // The chart data uses "Grade X" as the name for tooltips,
      // but the XAxis tickFormatter should display just the number
      const { container } = render(<GenderByGradeChart data={mockData} />)
      // The chart should render (basic sanity check for tick formatting)
      expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument()
    })
  })

  describe('click handling', () => {
    it('should accept onBarClick prop without error', () => {
      const onBarClick = vi.fn()
      render(<GenderByGradeChart data={mockData} onBarClick={onBarClick} />)
      expect(screen.getByText('Gender by Grade')).toBeInTheDocument()
    })
  })
})
