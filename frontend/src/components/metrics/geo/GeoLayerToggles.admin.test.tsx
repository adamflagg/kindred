/**
 * Tests for GeoLayerToggles admin-gated behavior.
 *
 * Validates that "Show sources" and "Show gaps" toggles
 * are only rendered when isAdmin is true.
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
  return screen.getAllByRole('checkbox') as HTMLInputElement[]
}

describe('GeoLayerToggles admin gating', () => {
  it('hides sources and gaps toggles when isAdmin is false', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={false} />)

    // Should have 4 layer toggles + 1 region zones toggle = 5 checkboxes
    expect(getCheckboxes()).toHaveLength(5)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })

  it('shows sources and gaps toggles when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)

    // Should have 4 layers + 1 region zones + 2 admin toggles = 7 checkboxes
    expect(getCheckboxes()).toHaveLength(7)
    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
    expect(screen.getByText(/Show gaps/)).toBeInTheDocument()
  })

  it('defaults isAdmin to false (safe default)', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })
})
