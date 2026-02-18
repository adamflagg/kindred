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

    // State abbreviations are in child spans, so check via textContent
    const rows = screen.getAllByRole('row')
    const sfRow = rows.find((row) => row.textContent?.includes('San Francisco'))
    expect(sfRow?.textContent).toContain(', CA')
    const portlandRow = rows.find((row) => row.textContent?.includes('Portland'))
    expect(portlandRow?.textContent).toContain(', OR')
    const denverRow = rows.find((row) => row.textContent?.includes('Denver'))
    expect(denverRow?.textContent).toContain(', CO')
  })

  it('does not display state abbreviation for school category', () => {
    const schoolItems: GeoDataItem[] = [{ name: 'Riverside Elementary', count: 10, percentage: 25 }]
    render(<GeoDetailList data={schoolItems} category="school" />)

    fireEvent.click(screen.getByText('Schools'))

    // Should show school name without state
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.queryByText(/Riverside Elementary,/)).not.toBeInTheDocument()
  })

  it('shows gap indicator for cities without coords when showGaps is true', () => {
    const itemsWithGaps: GeoDataItem[] = [
      { name: 'San Francisco', count: 25, percentage: 30 },
      { name: 'Harduf', count: 2, percentage: 2 }, // International, not in coord lookup
    ]

    render(<GeoDetailList data={itemsWithGaps} category="city" showGaps={true} />)

    fireEvent.click(screen.getByText('Cities'))

    // Harduf should have a gap indicator (amber dot)
    // San Francisco should not
    const rows = screen.getAllByRole('row')
    const hardufRow = rows.find((row) => row.textContent?.includes('Harduf'))
    expect(hardufRow).toBeDefined()
    expect(hardufRow?.querySelector('[data-unmatched]')).toBeTruthy()

    const sfRow = rows.find((row) => row.textContent?.includes('San Francisco'))
    expect(sfRow).toBeDefined()
    expect(sfRow?.querySelector('[data-unmatched]')).toBeFalsy()
  })

  it('does not show gap indicator when showGaps is false', () => {
    const itemsWithGaps: GeoDataItem[] = [{ name: 'Harduf', count: 2, percentage: 2 }]

    render(<GeoDetailList data={itemsWithGaps} category="city" showGaps={false} />)

    fireEvent.click(screen.getByText('Cities'))

    const rows = screen.getAllByRole('row')
    const hardufRow = rows.find((row) => row.textContent?.includes('Harduf'))
    expect(hardufRow?.querySelector('[data-unmatched]')).toBeFalsy()
  })

  it('shows gap indicator for schools without coords when showGaps is true', () => {
    const schoolItems: GeoDataItem[] = [
      { name: 'Unmapped Academy', count: 5, percentage: 10 },
    ]

    render(<GeoDetailList data={schoolItems} category="school" showGaps={true} />)

    fireEvent.click(screen.getByText('Schools'))

    const rows = screen.getAllByRole('row')
    const row = rows.find((row) => row.textContent?.includes('Unmapped Academy'))
    expect(row).toBeDefined()
    expect(row?.querySelector('[data-unmatched]')).toBeTruthy()
  })

  it('shows gap indicator for synagogues without coords when showGaps is true', () => {
    const synItems: GeoDataItem[] = [
      { name: 'Unmapped Temple', count: 3, percentage: 8 },
    ]

    render(<GeoDetailList data={synItems} category="synagogue" showGaps={true} />)

    fireEvent.click(screen.getByText('Synagogues'))

    const rows = screen.getAllByRole('row')
    const row = rows.find((row) => row.textContent?.includes('Unmapped Temple'))
    expect(row).toBeDefined()
    expect(row?.querySelector('[data-unmatched]')).toBeTruthy()
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
