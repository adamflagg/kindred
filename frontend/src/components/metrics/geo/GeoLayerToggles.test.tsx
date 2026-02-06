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
  it('renders 3 layer checkboxes plus region toggle (non-admin)', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    // 3 layers + 1 region = 4 (admin toggles hidden by default)
    expect(getCheckboxes()).toHaveLength(4)
  })

  it('renders all 7 checkboxes when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)
    // 3 layers + 1 region + 3 admin (sources, unmatched, gaps) = 7
    expect(getCheckboxes()).toHaveLength(7)
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

  it('renders region toggle but hides admin toggles for non-admin', () => {
    render(<GeoLayerToggles {...defaultProps} />)

    expect(screen.getByText(/Region zones/)).toBeInTheDocument()
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unmatched sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })

  it('renders all admin toggles when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)

    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
    expect(screen.getByText(/Unmatched sources/)).toBeInTheDocument()
    expect(screen.getByText(/Show gaps/)).toBeInTheDocument()
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
    render(<GeoLayerToggles {...defaultProps} onToggleSources={onToggleSources} isAdmin={true} />)

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
    render(
      <GeoLayerToggles {...defaultProps} showRegions={false} showSources={true} isAdmin={true} />
    )

    const boxes = getCheckboxes()
    expect(boxes[3]?.checked).toBe(false) // regions
    expect(boxes[4]?.checked).toBe(true) // sources
  })

  it('calls onToggleUnmatched when unmatched checkbox is clicked', () => {
    const onToggleUnmatched = vi.fn()
    render(
      <GeoLayerToggles
        {...defaultProps}
        isAdmin={true}
        showUnmatched={false}
        onToggleUnmatched={onToggleUnmatched}
      />
    )

    const boxes = getCheckboxes()
    // 3 layers + region + sources + unmatched + gaps = index 5
    fireEvent.click(boxes[5] as HTMLElement)
    expect(onToggleUnmatched).toHaveBeenCalledOnce()
  })

  it('calls onToggleGaps when gaps checkbox is clicked', () => {
    const onToggleGaps = vi.fn()
    render(
      <GeoLayerToggles
        {...defaultProps}
        isAdmin={true}
        showGaps={false}
        onToggleGaps={onToggleGaps}
      />
    )

    const boxes = getCheckboxes()
    // 3 layers + region + sources + unmatched + gaps = index 6
    fireEvent.click(boxes[6] as HTMLElement)
    expect(onToggleGaps).toHaveBeenCalledOnce()
  })
})
