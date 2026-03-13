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
}

/** Get all checkboxes as typed inputs */
function getCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole('checkbox')
}

describe('GeoLayerToggles', () => {
  it('renders 4 layer checkboxes plus region toggle', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    // 4 layers + 1 region zones = 5
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

  it('calls onToggleLayer with correct category when clicked', () => {
    const onToggleLayer = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleLayer={onToggleLayer} />)

    // Order: city, school, synagogue, region, region zones
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

  it('reflects checked state from activeLayers prop', () => {
    const partialLayers = new Set<GeoCategoryExtended>(['city'])
    render(<GeoLayerToggles {...defaultProps} activeLayers={partialLayers} />)

    const boxes = getCheckboxes()
    expect(boxes[0]?.checked).toBe(true) // city
    expect(boxes[1]?.checked).toBe(false) // school
    expect(boxes[2]?.checked).toBe(false) // synagogue
    expect(boxes[3]?.checked).toBe(false) // region
  })

  it('reflects showRegions state', () => {
    render(
      <GeoLayerToggles
        {...defaultProps}
        showRegions={false}
      />
    )

    const boxes = getCheckboxes()
    expect(boxes[4]?.checked).toBe(false) // region zones
  })
})
