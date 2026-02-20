/**
 * TDD Tests for MetricCard component onClick functionality.
 *
 * Tests are written FIRST before implementation (TDD).
 * This component displays a metric card with optional click-to-drilldown.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetricCard } from './MetricCard'

describe('MetricCard onClick functionality', () => {
  describe('rendering without onClick', () => {
    it('should render normally without onClick prop', () => {
      render(<MetricCard title="Total Enrolled" value={150} subtitle="Active enrollments" />)

      expect(screen.getByText('Total Enrolled')).toBeInTheDocument()
      expect(screen.getByText('150')).toBeInTheDocument()
      expect(screen.getByText('Active enrollments')).toBeInTheDocument()
    })

    it('should not have pointer cursor when onClick is not provided', () => {
      render(<MetricCard title="Total Enrolled" value={150} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      // Check that cursor-pointer class is NOT present
      expect(card).not.toHaveClass('cursor-pointer')
    })
  })

  describe('click behavior', () => {
    it('should call onClick when card is clicked', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      fireEvent.click(card!)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should show pointer cursor when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      expect(card).toHaveClass('cursor-pointer')
    })

    it('should not trigger onClick when onClick is not provided', () => {
      // This verifies that the click handler is only set when onClick prop exists
      render(<MetricCard title="Total Enrolled" value={150} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      // Clicking should not throw
      expect(() => fireEvent.click(card!)).not.toThrow()
    })
  })

  describe('keyboard accessibility', () => {
    it('should respond to Enter key when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      fireEvent.keyDown(card!, { key: 'Enter', code: 'Enter' })

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should respond to Space key when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      fireEvent.keyDown(card!, { key: ' ', code: 'Space' })

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should not respond to Enter key when onClick is not provided', () => {
      render(<MetricCard title="Total Enrolled" value={150} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      // Should not throw when pressing Enter without onClick
      expect(() => fireEvent.keyDown(card!, { key: 'Enter', code: 'Enter' })).not.toThrow()
    })

    it('should have tabIndex when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      expect(card).toHaveAttribute('tabIndex', '0')
    })

    it('should not have tabIndex when onClick is not provided', () => {
      render(<MetricCard title="Total Enrolled" value={150} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      expect(card).not.toHaveAttribute('tabIndex', '0')
    })

    it('should have role="button" when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      expect(card).toHaveAttribute('role', 'button')
    })

    it('should not have role="button" when onClick is not provided', () => {
      render(<MetricCard title="Total Enrolled" value={150} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      expect(card).not.toHaveAttribute('role', 'button')
    })
  })

  describe('hover state', () => {
    it('should have hover style class when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      // Check for hover styling class
      expect(card).toHaveClass('hover:bg-muted/30')
    })
  })

  describe('sentiment prop', () => {
    it('should use green for up and red for down by default (no sentiment prop)', () => {
      render(
        <MetricCard title="Total Enrolled" value={150} compareValue={140} compareYear={2025} />
      )

      const trendSpan = screen.getByText(/\+10/).closest('span')
      expect(trendSpan).toHaveClass('text-emerald-600')
    })

    it('should use green for up and red for down with sentiment="default"', () => {
      render(
        <MetricCard
          title="Total Enrolled"
          value={150}
          compareValue={140}
          compareYear={2025}
          sentiment="default"
        />
      )

      const trendSpan = screen.getByText(/\+10/).closest('span')
      expect(trendSpan).toHaveClass('text-emerald-600')
    })

    it('should swap colors with sentiment="inverse" — up becomes red', () => {
      render(
        <MetricCard
          title="Total Cancelled"
          value={20}
          compareValue={15}
          compareYear={2025}
          sentiment="inverse"
        />
      )

      // Value went up (20 > 15) but with inverse sentiment, up should show red
      const trendSpan = screen.getByText(/\+5/).closest('span')
      expect(trendSpan).toHaveClass('text-red-600')
    })

    it('should swap colors with sentiment="inverse" — down becomes green', () => {
      render(
        <MetricCard
          title="Total Cancelled"
          value={10}
          compareValue={15}
          compareYear={2025}
          sentiment="inverse"
        />
      )

      // Value went down (10 < 15) but with inverse sentiment, down should show green
      const trendSpan = screen.getByText(/-5/).closest('span')
      expect(trendSpan).toHaveClass('text-emerald-600')
    })

    it('should use blue color for both up and down with sentiment="neutral"', () => {
      render(
        <MetricCard
          title="New Campers"
          value={50}
          compareValue={40}
          compareYear={2025}
          sentiment="neutral"
        />
      )

      // Value went up but with neutral sentiment, should show blue
      const trendSpan = screen.getByText(/\+10/).closest('span')
      expect(trendSpan).toHaveClass('text-blue-600')
    })

    it('should use blue color for down direction with sentiment="neutral"', () => {
      render(
        <MetricCard
          title="New Campers"
          value={30}
          compareValue={40}
          compareYear={2025}
          sentiment="neutral"
        />
      )

      const trendSpan = screen.getByText(/-10/).closest('span')
      expect(trendSpan).toHaveClass('text-blue-600')
    })
  })

  describe('existing functionality preserved', () => {
    it('should still display trend indicators when provided', () => {
      render(<MetricCard title="Total Enrolled" value={150} trend="up" trendValue="+15%" />)

      expect(screen.getByText('+15%')).toBeInTheDocument()
    })

    it('should still auto-calculate delta when compareValue is provided', () => {
      render(
        <MetricCard title="Total Enrolled" value={150} compareValue={140} compareYear={2025} />
      )

      expect(screen.getByText('+10 vs 2025')).toBeInTheDocument()
    })

    it('should work with onClick and trend indicators together', () => {
      const handleClick = vi.fn()
      render(
        <MetricCard
          title="Total Enrolled"
          value={150}
          trend="up"
          trendValue="+15%"
          onClick={handleClick}
        />
      )

      expect(screen.getByText('+15%')).toBeInTheDocument()

      const card = screen.getByText('Total Enrolled').closest('div')
      fireEvent.click(card!)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})
