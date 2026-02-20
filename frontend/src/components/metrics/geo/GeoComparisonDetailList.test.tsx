/**
 * Tests for GeoComparisonDetailList component.
 *
 * TDD: Tests written first to define comparison table behavior for geo data.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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

    expect(screen.getByText(/schools/i)).toBeInTheDocument()
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

    expect(screen.getByText(/synagogues/i)).toBeInTheDocument()
    expect(screen.getByText('Temple Beth')).toBeInTheDocument()
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
