/**
 * Tests for GeoComparisonDetailList component.
 *
 * TDD: Tests written first to define comparison table behavior for geo data.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GeoComparisonDetailList } from './GeoComparisonDetailList'

describe('GeoComparisonDetailList', () => {
  const primaryData = [
    { name: 'Oakland', count: 30, percentage: 25.0 },
    { name: 'San Francisco', count: 20, percentage: 16.7 },
    { name: 'Berkeley', count: 10, percentage: 8.3 },
  ]

  const compareData = [
    { name: 'Oakland', count: 25, percentage: 22.7 },
    { name: 'San Francisco', count: 22, percentage: 20.0 },
    { name: 'Los Angeles', count: 5, percentage: 4.5 },
  ]

  it('renders the category header', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={primaryData}
        compareData={compareData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    expect(screen.getByText(/cities/i)).toBeInTheDocument()
  })

  it('renders year column headers', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={primaryData}
        compareData={compareData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/cities/i))
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('Change')).toBeInTheDocument()
  })

  it('renders merged rows with both years data', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={primaryData}
        compareData={compareData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/cities/i))
    // Common items
    expect(screen.getByText('Oakland')).toBeInTheDocument()
    expect(screen.getByText('San Francisco')).toBeInTheDocument()
  })

  it('shows NEW indicator for items only in primary year', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={primaryData}
        compareData={compareData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/cities/i))
    // Berkeley is only in primary
    expect(screen.getByText('Berkeley')).toBeInTheDocument()
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('shows GONE indicator for items only in comparison year', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={primaryData}
        compareData={compareData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/cities/i))
    // Los Angeles is only in compare
    expect(screen.getByText('Los Angeles')).toBeInTheDocument()
    expect(screen.getByText('GONE')).toBeInTheDocument()
  })

  it('works with school category', () => {
    render(
      <GeoComparisonDetailList
        category="school"
        primaryData={[{ name: 'Riverside Elementary', count: 15, percentage: 12.5 }]}
        compareData={[{ name: 'Riverside Elementary', count: 12, percentage: 10.9 }]}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/schools/i))
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
  })

  it('works with synagogue category', () => {
    render(
      <GeoComparisonDetailList
        category="synagogue"
        primaryData={[{ name: 'Temple Beth', count: 8, percentage: 6.7 }]}
        compareData={[{ name: 'Temple Beth', count: 10, percentage: 9.1 }]}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    fireEvent.click(screen.getByText(/synagogues/i))
    expect(screen.getByText('Temple Beth')).toBeInTheDocument()
  })

  describe('collapse behavior', () => {
    it('starts collapsed by default', () => {
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
        />
      )

      // Header should be visible
      expect(screen.getByText(/cities/i)).toBeInTheDocument()
      // Table content should NOT be visible (collapsed)
      expect(screen.queryByText('Oakland')).not.toBeInTheDocument()
    })

    it('expands when header is clicked', () => {
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
        />
      )

      fireEvent.click(screen.getByText(/cities/i))

      // Should now show table content
      expect(screen.getByText('Oakland')).toBeInTheDocument()
      expect(screen.getByText('2025')).toBeInTheDocument()
      expect(screen.getByText('2024')).toBeInTheDocument()
    })

    it('collapses when header is clicked again', () => {
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
        />
      )

      // Expand
      fireEvent.click(screen.getByText(/cities/i))
      expect(screen.getByText('Oakland')).toBeInTheDocument()

      // Collapse
      fireEvent.click(screen.getByText(/cities/i))
      expect(screen.queryByText('Oakland')).not.toBeInTheDocument()
    })
  })

  describe('controlled mode', () => {
    it('uses isOpen prop when provided', () => {
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
          isOpen={true}
        />
      )

      // Should be expanded because isOpen=true
      expect(screen.getByText('Oakland')).toBeInTheDocument()
    })

    it('stays collapsed when isOpen=false', () => {
      const onToggle = vi.fn()
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
          isOpen={false}
          onToggle={onToggle}
        />
      )

      expect(screen.queryByText('Oakland')).not.toBeInTheDocument()

      // Click header — calls onToggle but stays collapsed (controlled)
      fireEvent.click(screen.getByText(/cities/i))
      expect(onToggle).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Oakland')).not.toBeInTheDocument()
    })

    it('calls onToggle on header click in controlled mode', () => {
      const onToggle = vi.fn()
      render(
        <GeoComparisonDetailList
          category="city"
          primaryData={primaryData}
          compareData={compareData}
          primaryYear={2025}
          compareYear={2024}
          isOpen={true}
          onToggle={onToggle}
        />
      )

      fireEvent.click(screen.getByText(/cities/i))
      expect(onToggle).toHaveBeenCalledTimes(1)
    })
  })

  it('renders empty state when no data', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={[]}
        compareData={[]}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
