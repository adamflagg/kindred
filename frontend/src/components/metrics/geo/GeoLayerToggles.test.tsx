/**
 * Tests for GeoLayerToggles component.
 *
 * Validates checkbox rendering, callback invocations,
 * and checked state for data layers and secondary toggles.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GeoLayerToggles } from './GeoLayerToggles'
import type { GeoCategoryExtended } from './GeoCategoryTabs'

const defaultProps = {
  activeLayers: new Set<GeoCategoryExtended>(['city', 'school', 'synagogue', 'region']),
  onToggleLayer: vi.fn(),
  counts: { city: 42, school: 38, synagogue: 15, region: 9 },
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
  it('renders 4 layer checkboxes plus region toggle (non-admin)', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    // 4 layers + 1 region zones = 5 (admin toggles hidden by default)
    expect(getCheckboxes()).toHaveLength(5)
  })

  it('renders all 7 checkboxes when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)
    // 4 layers + 1 region zones + 2 admin (sources, gaps) = 7
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
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })

  it('renders all admin toggles when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)

    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
    expect(screen.getByText(/Show gaps/)).toBeInTheDocument()
  })

  it('calls onToggleLayer with correct category when clicked', () => {
    const onToggleLayer = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleLayer={onToggleLayer} />)

    // Order: city, school, synagogue, region, region zones, sources, gaps
    const boxes = getCheckboxes()
    fireEvent.click(boxes[1] as HTMLElement)
    expect(onToggleLayer).toHaveBeenCalledWith('school')
  })

  it('calls onToggleRegions when region zones checkbox is clicked', () => {
    const onToggleRegions = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleRegions={onToggleRegions} />)

    const boxes = getCheckboxes()
    fireEvent.click(boxes[4] as HTMLElement)
    expect(onToggleRegions).toHaveBeenCalledOnce()
  })

  it('calls onToggleSources when sources checkbox is clicked', () => {
    const onToggleSources = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleSources={onToggleSources} isAdmin={true} />)

    const boxes = getCheckboxes()
    fireEvent.click(boxes[5] as HTMLElement)
    expect(onToggleSources).toHaveBeenCalledOnce()
  })

  it('reflects checked state from activeLayers prop', () => {
    const partialLayers = new Set<GeoCategoryExtended>(['city'])
    render(<GeoLayerToggles {...defaultProps} activeLayers={partialLayers} />)

    const boxes = getCheckboxes()
    expect(boxes[0]?.checked).toBe(true) // city
    expect(boxes[1]?.checked).toBe(false) // school
    expect(boxes[2]?.checked).toBe(false) // synagogue
    expect(boxes[3]?.checked).toBe(false) // region
  })

  it('reflects showRegions and showSources state', () => {
    render(
      <GeoLayerToggles {...defaultProps} showRegions={false} showSources={true} isAdmin={true} />
    )

    const boxes = getCheckboxes()
    expect(boxes[4]?.checked).toBe(false) // region zones
    expect(boxes[5]?.checked).toBe(true) // sources
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
    // 4 layers + region zones + sources + gaps = index 6
    fireEvent.click(boxes[6] as HTMLElement)
    expect(onToggleGaps).toHaveBeenCalledOnce()
  })
})
