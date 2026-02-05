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

describe('GeoLayerToggles', () => {
  it('renders 3 layer checkboxes plus 2 secondary toggles', () => {
    render(<GeoLayerToggles {...defaultProps} />)

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(5)
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

    // Click the Schools checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    // Order: city, school, synagogue, regions, sources
    fireEvent.click(checkboxes[1])
    expect(onToggleLayer).toHaveBeenCalledWith('school')
  })

  it('calls onToggleRegions when region checkbox is clicked', () => {
    const onToggleRegions = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleRegions={onToggleRegions} />)

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[3])
    expect(onToggleRegions).toHaveBeenCalledOnce()
  })

  it('calls onToggleSources when sources checkbox is clicked', () => {
    const onToggleSources = vi.fn()
    render(<GeoLayerToggles {...defaultProps} onToggleSources={onToggleSources} />)

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[4])
    expect(onToggleSources).toHaveBeenCalledOnce()
  })

  it('reflects checked state from activeLayers prop', () => {
    const partialLayers = new Set<GeoCategory>(['city'])
    render(<GeoLayerToggles {...defaultProps} activeLayers={partialLayers} />)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[0].checked).toBe(true) // city
    expect(checkboxes[1].checked).toBe(false) // school
    expect(checkboxes[2].checked).toBe(false) // synagogue
  })

  it('reflects showRegions and showSources state', () => {
    render(<GeoLayerToggles {...defaultProps} showRegions={false} showSources={true} />)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[3].checked).toBe(false) // regions
    expect(checkboxes[4].checked).toBe(true) // sources
  })
})
