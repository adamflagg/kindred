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
  })

  describe('click behavior', () => {
    it('should call onClick when card is clicked', () => {
      const handleClick = vi.fn()
      render(<MetricCard title="Total Enrolled" value={150} onClick={handleClick} />)

      const card = screen.getByText('Total Enrolled').closest('div')
      fireEvent.click(card!)

      expect(handleClick).toHaveBeenCalledTimes(1)
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

  describe('sentiment prop', () => {
    it.each([
      {
        sentiment: undefined,
        value: 150,
        compareValue: 140,
        pattern: /\+10/,
        expectedClass: 'text-emerald-600',
        desc: 'default up=green',
      },
      {
        sentiment: 'default' as const,
        value: 150,
        compareValue: 140,
        pattern: /\+10/,
        expectedClass: 'text-emerald-600',
        desc: 'explicit default up=green',
      },
      {
        sentiment: 'inverse' as const,
        value: 20,
        compareValue: 15,
        pattern: /\+5/,
        expectedClass: 'text-red-600',
        desc: 'inverse up=red',
      },
      {
        sentiment: 'inverse' as const,
        value: 10,
        compareValue: 15,
        pattern: /-5/,
        expectedClass: 'text-emerald-600',
        desc: 'inverse down=green',
      },
      {
        sentiment: 'neutral' as const,
        value: 50,
        compareValue: 40,
        pattern: /\+10/,
        expectedClass: 'text-blue-600',
        desc: 'neutral up=blue',
      },
      {
        sentiment: 'neutral' as const,
        value: 30,
        compareValue: 40,
        pattern: /-10/,
        expectedClass: 'text-blue-600',
        desc: 'neutral down=blue',
      },
    ])('$desc', ({ sentiment, value, compareValue, pattern, expectedClass }) => {
      render(
        <MetricCard
          title="Test"
          value={value}
          compareValue={compareValue}
          compareYear={2025}
          sentiment={sentiment}
        />
      )

      const trendSpan = screen.getByText(pattern).closest('span')
      expect(trendSpan).toHaveClass(expectedClass)
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
