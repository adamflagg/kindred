/**
 * Tests for GeoDetailList component.
 *
 * Validates state abbreviation display for city category
 * and unmatched indicator rendering.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GeoDetailList } from './GeoDetailList'
import type { GeoDataItem } from './GeoMap'

const cityItems: GeoDataItem[] = [
  { name: 'San Francisco', count: 25, percentage: 30 },
  { name: 'Portland', count: 10, percentage: 12 },
  { name: 'Denver', count: 5, percentage: 6 },
]

describe('GeoDetailList', () => {
  it('renders city list with header and items when expanded', () => {
    render(<GeoDetailList data={cityItems} category="city" />)

    // Click header to expand
    fireEvent.click(screen.getByText('Cities'))

    expect(screen.getByText('San Francisco')).toBeInTheDocument()
    expect(screen.getByText('Portland')).toBeInTheDocument()
    expect(screen.getByText('Denver')).toBeInTheDocument()
  })

  it('displays state abbreviation after city name for city category', () => {
    render(<GeoDetailList data={cityItems} category="city" />)

    // Click header to expand
    fireEvent.click(screen.getByText('Cities'))

    // Cities should show "City, ST" format
    expect(screen.getByText(/San Francisco, CA/)).toBeInTheDocument()
    expect(screen.getByText(/Portland, OR/)).toBeInTheDocument()
    expect(screen.getByText(/Denver, CO/)).toBeInTheDocument()
  })

  it('does not display state abbreviation for school category', () => {
    const schoolItems: GeoDataItem[] = [{ name: 'Riverside Elementary', count: 10, percentage: 25 }]
    render(<GeoDetailList data={schoolItems} category="school" />)

    fireEvent.click(screen.getByText('Schools'))

    // Should show school name without state
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.queryByText(/Riverside Elementary,/)).not.toBeInTheDocument()
  })

  it('shows unmatched indicator for cities not in US_CITY_COORDS when showUnmatched is true', () => {
    const itemsWithUnmatched: GeoDataItem[] = [
      { name: 'San Francisco', count: 25, percentage: 30 },
      { name: 'London', count: 2, percentage: 2 }, // Not in US cities
    ]

    render(<GeoDetailList data={itemsWithUnmatched} category="city" showUnmatched={true} />)

    fireEvent.click(screen.getByText('Cities'))

    // London should have an unmatched indicator (amber dot or similar)
    // San Francisco should not
    const rows = screen.getAllByRole('row')
    // Find the London row - it should contain the unmatched indicator
    const londonRow = rows.find((row) => row.textContent?.includes('London'))
    expect(londonRow).toBeDefined()
    expect(londonRow?.querySelector('[data-unmatched]')).toBeTruthy()

    // San Francisco row should NOT have the unmatched indicator
    const sfRow = rows.find((row) => row.textContent?.includes('San Francisco'))
    expect(sfRow).toBeDefined()
    expect(sfRow?.querySelector('[data-unmatched]')).toBeFalsy()
  })

  it('does not show unmatched indicator when showUnmatched is false', () => {
    const itemsWithUnmatched: GeoDataItem[] = [{ name: 'London', count: 2, percentage: 2 }]

    render(<GeoDetailList data={itemsWithUnmatched} category="city" showUnmatched={false} />)

    fireEvent.click(screen.getByText('Cities'))

    const rows = screen.getAllByRole('row')
    const londonRow = rows.find((row) => row.textContent?.includes('London'))
    expect(londonRow?.querySelector('[data-unmatched]')).toBeFalsy()
  })

  it('triggers drilldown on row click', () => {
    const onDrilldown = vi.fn()
    render(<GeoDetailList data={cityItems} category="city" onDrilldown={onDrilldown} />)

    fireEvent.click(screen.getByText('Cities'))
    fireEvent.click(screen.getByText(/San Francisco/))

    expect(onDrilldown).toHaveBeenCalledWith({
      type: 'city',
      value: 'San Francisco',
      label: 'San Francisco',
    })
  })
})
