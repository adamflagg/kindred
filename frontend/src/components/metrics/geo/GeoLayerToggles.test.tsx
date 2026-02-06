/**
 * Tests for GeoLayerToggles component.
 *
 * Validates checkbox rendering, callback invocations,
 * and checked state for data layers and secondary toggles.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GeoLayerToggles } from './GeoLayerToggles'
import type { GeoCategory } from './GeoCategoryTabs'

const defaultProps = {
  activeLayers: new Set<GeoCategory>(['city', 'school', 'synagogue']),
  onToggleLayer: vi.fn(),
  counts: { city: 42, school: 38, synagogue: 15 },
  showRegions: true,
  onToggleRegions: vi.fn(),
  showSources: false,
  onToggleSources: vi.fn(),
}

/** Get all checkboxes as typed inputs */
function getCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole('checkbox') as HTMLInputElement[]
}

describe('GeoLayerToggles', () => {
  it('renders 3 layer checkboxes plus 2 secondary toggles', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    expect(getCheckboxes()).toHaveLength(5)
  })

  it('renders layer labels with counts', () => {
    render(<GeoLayerToggles {...defaultProps} />)

    expect(screen.getByText(/Cities/)).toBeInTheDocument()
    expect(screen.getByText(/42/)).toBeInTheDocument()
    expect(screen.getByText(/Schools/)).toBeInTheDocument()
    expect(screen.getByText(/38/)).toBeInTheDocument()
    expect(screen.getByText(/Synagogues/)).toBeInTheDocument()
    expect(screen.getByText(/15/)).toBeInTheDocument()
  })

  it('renders region and sources toggle labels', () => {
    render(<GeoLayerToggles {...defaultProps} />)

    expect(screen.getByText(/Region zones/)).toBeInTheDocument()
    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
  })

  it('calls onToggleLayer with correct category when clicked', () => {
    const onToggleLayer = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleLayer={onToggleLayer} />)

    // Order: city, school, synagogue, regions, sources
    const boxes = getCheckboxes()
    fireEvent.click(boxes[1] as HTMLElement)
    expect(onToggleLayer).toHaveBeenCalledWith('school')
  })

  it('calls onToggleRegions when region checkbox is clicked', () => {
    const onToggleRegions = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleRegions={onToggleRegions} />)

    const boxes = getCheckboxes()
    fireEvent.click(boxes[3] as HTMLElement)
    expect(onToggleRegions).toHaveBeenCalledOnce()
  })

  it('calls onToggleSources when sources checkbox is clicked', () => {
    const onToggleSources = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleSources={onToggleSources} />)

    const boxes = getCheckboxes()
    fireEvent.click(boxes[4] as HTMLElement)
    expect(onToggleSources).toHaveBeenCalledOnce()
  })

  it('reflects checked state from activeLayers prop', () => {
    const partialLayers = new Set<GeoCategory>(['city'])
    render(<GeoLayerToggles {...defaultProps} activeLayers={partialLayers} />)

    const boxes = getCheckboxes()
    expect(boxes[0]?.checked).toBe(true) // city
    expect(boxes[1]?.checked).toBe(false) // school
    expect(boxes[2]?.checked).toBe(false) // synagogue
  })

  it('reflects showRegions and showSources state', () => {
    render(<GeoLayerToggles {...defaultProps} showRegions={false} showSources={true} />)

    const boxes = getCheckboxes()
    expect(boxes[3]?.checked).toBe(false) // regions
    expect(boxes[4]?.checked).toBe(true) // sources
  })

  it('renders unmatched toggle when props are provided', () => {
    const onToggleUnmatched = vi.fn()
    render(
      <GeoLayerToggles
        {...defaultProps}
        showUnmatched={false}
        onToggleUnmatched={onToggleUnmatched}
      />
    )

    expect(screen.getByText(/Unmatched sources/)).toBeInTheDocument()
    // Now 6 checkboxes: 3 layers + regions + sources + unmatched
    expect(getCheckboxes()).toHaveLength(6)
  })

  it('does not render unmatched toggle when props are omitted', () => {
    render(<GeoLayerToggles {...defaultProps} />)

    expect(screen.queryByText(/Unmatched sources/)).not.toBeInTheDocument()
    expect(getCheckboxes()).toHaveLength(5)
  })

  it('calls onToggleUnmatched when unmatched checkbox is clicked', () => {
    const onToggleUnmatched = vi.fn()
    render(
      <GeoLayerToggles
        {...defaultProps}
        showUnmatched={false}
        onToggleUnmatched={onToggleUnmatched}
      />
    )

    const boxes = getCheckboxes()
    fireEvent.click(boxes[5] as HTMLElement)
    expect(onToggleUnmatched).toHaveBeenCalledOnce()
  })
})
