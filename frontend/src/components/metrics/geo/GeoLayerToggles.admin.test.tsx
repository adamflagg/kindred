/**
 * Tests for GeoLayerToggles admin-gated behavior.
 *
 * Validates that "Show sources" and "Show gaps" toggles
 * are only rendered when isAdmin is true.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    // Should have 3 layer toggles + 1 region toggle = 4 checkboxes
    expect(getCheckboxes()).toHaveLength(4)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })

  it('shows sources and gaps toggles when isAdmin is true', () => {
    render(<GeoLayerToggles {...defaultProps} isAdmin={true} />)

    // Should have 3 layers + 1 region + 2 admin toggles = 6 checkboxes
    expect(getCheckboxes()).toHaveLength(6)
    expect(screen.getByText(/Show sources/)).toBeInTheDocument()
    expect(screen.getByText(/Show gaps/)).toBeInTheDocument()
  })

  it('defaults isAdmin to false (safe default)', () => {
    render(<GeoLayerToggles {...defaultProps} />)
    expect(screen.queryByText(/Show sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show gaps/)).not.toBeInTheDocument()
  })
})
