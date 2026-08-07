/**
 * Tests for GeoDetailList component.
 *
 * Validates state abbreviation display for city category
 * and controlled/uncontrolled expand behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoDetailList } from './GeoDetailList'
import type { GeoDataItem } from './GeoMap'

const cityItems: GeoDataItem[] = [
  { name: 'San Francisco, CA', count: 25, percentage: 30 },
  { name: 'Portland, OR', count: 10, percentage: 12 },
  { name: 'Denver, CO', count: 5, percentage: 6 },
]

describe('GeoDetailList', () => {
  it('renders city list with header and items when expanded', () => {
    render(<GeoDetailList data={cityItems} category="city" />)

    // Click header to expand
    fireEvent.click(screen.getByText('Cities'))

    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
    expect(screen.getByText('Portland, OR')).toBeInTheDocument()
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
  })

  it('displays city names with state suffix from "City, ST" format', () => {
    render(<GeoDetailList data={cityItems} category="city" />)

    // Click header to expand
    fireEvent.click(screen.getByText('Cities'))

    // Exact match — catches state-suffix duplication regressions like "CA, CA"
    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
    expect(screen.getByText('Portland, OR')).toBeInTheDocument()
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
  })

  it('does not display state abbreviation for school category', () => {
    const schoolItems: GeoDataItem[] = [{ name: 'Riverside Elementary', count: 10, percentage: 25 }]
    render(<GeoDetailList data={schoolItems} category="school" />)

    fireEvent.click(screen.getByText('Schools'))

    // Should show school name without state
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.queryByText(/Riverside Elementary,/)).not.toBeInTheDocument()
  })

  describe('controlled expand mode', () => {
    it('uses isOpen prop to control expand state when provided', () => {
      render(<GeoDetailList data={cityItems} category="city" isOpen={true} />)

      // Should be expanded because isOpen=true
      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
    })

    it('stays collapsed when isOpen=false even after header click', () => {
      const onToggle = vi.fn()
      render(<GeoDetailList data={cityItems} category="city" isOpen={false} onToggle={onToggle} />)

      // Should be collapsed
      expect(screen.queryByText('San Francisco, CA')).not.toBeInTheDocument()

      // Click header — should call onToggle but NOT expand (controlled mode)
      fireEvent.click(screen.getByText('Cities'))
      expect(onToggle).toHaveBeenCalledTimes(1)
      // Still collapsed because isOpen is still false (controlled by parent)
      expect(screen.queryByText('San Francisco, CA')).not.toBeInTheDocument()
    })

    it('calls onToggle when header is clicked in controlled mode', () => {
      const onToggle = vi.fn()
      render(<GeoDetailList data={cityItems} category="city" isOpen={true} onToggle={onToggle} />)

      fireEvent.click(screen.getByText('Cities'))
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('works in uncontrolled mode when isOpen is not provided', () => {
      render(<GeoDetailList data={cityItems} category="city" />)

      // Initially collapsed
      expect(screen.queryByText('San Francisco, CA')).not.toBeInTheDocument()

      // Click to expand
      fireEvent.click(screen.getByText('Cities'))
      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()

      // Click to collapse
      fireEvent.click(screen.getByText('Cities'))
      expect(screen.queryByText('San Francisco, CA')).not.toBeInTheDocument()
    })
  })

  it('triggers drilldown on row click', () => {
    const onDrilldown = vi.fn()
    render(<GeoDetailList data={cityItems} category="city" onDrilldown={onDrilldown} />)

    fireEvent.click(screen.getByText('Cities'))
    fireEvent.click(screen.getByText(/San Francisco/))

    expect(onDrilldown).toHaveBeenCalledWith({
      type: 'city',
      value: 'San Francisco, CA',
      label: 'San Francisco, CA',
    })
  })

  it('triggers drilldown on Enter key press', async () => {
    // The affordance is a real `<button>` (kindred#2063), so keyboard
    // activation is native — a raw `fireEvent.keyDown` no longer does
    // anything; `userEvent` is what actually simulates a browser's default
    // key handling for a focused button.
    const onDrilldown = vi.fn()
    render(<GeoDetailList data={cityItems} category="city" onDrilldown={onDrilldown} />)

    fireEvent.click(screen.getByText('Cities'))
    screen.getByRole('button', { name: /San Francisco/ }).focus()
    await userEvent.keyboard('{Enter}')

    expect(onDrilldown).toHaveBeenCalledWith({
      type: 'city',
      value: 'San Francisco, CA',
      label: 'San Francisco, CA',
    })
  })

  it('triggers drilldown on Space key press', async () => {
    const onDrilldown = vi.fn()
    render(<GeoDetailList data={cityItems} category="city" onDrilldown={onDrilldown} />)

    fireEvent.click(screen.getByText('Cities'))
    screen.getByRole('button', { name: /San Francisco/ }).focus()
    await userEvent.keyboard('[Space]')

    expect(onDrilldown).toHaveBeenCalledWith({
      type: 'city',
      value: 'San Francisco, CA',
      label: 'San Francisco, CA',
    })
  })

  it('does not add keyboard interactivity to region rows', () => {
    const regionItems: GeoDataItem[] = [{ name: 'West', count: 50, percentage: 60 }]
    render(<GeoDetailList data={regionItems} category="region" />)

    fireEvent.click(screen.getByText('Regions'))
    const row = screen.getByText('West').closest('tr')!
    expect(row).not.toHaveAttribute('tabindex')
    expect(row).not.toHaveAttribute('role')
    // Non-clickable rows (region) get no button at all, not just an inert row.
    expect(screen.queryByRole('button', { name: 'West' })).not.toBeInTheDocument()
  })

  it('keeps native row semantics — the table is not collapsed to one row (kindred#2063)', () => {
    // `role="button"` on the `<tr>` used to override the native `row` role,
    // so `queryAllByRole('row')` collapsed to 1 (the header alone) and the
    // cells lost their owning row.
    render(<GeoDetailList data={cityItems} category="city" />)
    fireEvent.click(screen.getByText('Cities'))

    expect(screen.getAllByRole('row')).toHaveLength(cityItems.length + 1)
  })
})
