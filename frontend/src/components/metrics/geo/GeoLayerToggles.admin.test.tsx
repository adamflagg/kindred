/**
 * Tests for GeoLayerToggles permission-gated behavior.
 *
 * Validates that "Show sources" and "Show gaps" toggles
 * are only rendered when hasGeoPermission is true.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  showGaps: false,
  onToggleGaps: vi.fn(),
}

/** Get all checkboxes as typed inputs */
function getCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole('checkbox')
}

describe('GeoLayerToggles permission gating', () => {
  it('hides sources and gaps toggles when hasGeoPermission is false', () => {
    render(<GeoLayerToggles {...defaultProps} hasGeoPermission={false} />)

    // Should have 4 layer toggles + 1 region zones toggle = 5 checkboxes
    expect(getCheckboxes()).toHaveLength(5)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })

  it('shows sources and gaps toggles when hasGeoPermission is true', () => {
    render(<GeoLayerToggles {...defaultProps} hasGeoPermission={true} />)

    // Should have 4 layers + 1 region zones + 2 geo permission toggles = 7 checkboxes
    expect(getCheckboxes()).toHaveLength(7)
    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
    expect(screen.getByText(/Show gaps/)).toBeInTheDocument()
  })

  it('defaults hasGeoPermission to false (safe default)', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })
})
