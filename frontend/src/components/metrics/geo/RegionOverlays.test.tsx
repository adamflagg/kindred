/**
 * Tests for RegionOverlays component.
 *
 * Validates that region polygons render when show=true
 * and nothing renders when show=false.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { RegionOverlays } from './RegionOverlays'

// Mock react-leaflet components
vi.mock('react-leaflet', () => ({
  Polygon: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="polygon" data-positions={JSON.stringify(props.positions)}>
      {children}
    </div>
  ),
  Tooltip: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div
      data-testid="tooltip"
      data-permanent={props.permanent ? 'true' : 'false'}
      data-direction={props.direction}
    >
      {children}
    </div>
  ),
}))

describe('RegionOverlays', () => {
  it('returns null when show is false', () => {
    const { container } = render(<RegionOverlays show={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders 6 polygons when show is true', () => {
    const { getAllByTestId } = render(<RegionOverlays show={true} />)
    const polygons = getAllByTestId('polygon')
    expect(polygons).toHaveLength(6)
  })

  it('renders permanent tooltips for each region', () => {
    const { getAllByTestId } = render(<RegionOverlays show={true} />)
    const tooltips = getAllByTestId('tooltip')
    expect(tooltips).toHaveLength(6)
    for (const tooltip of tooltips) {
      expect(tooltip.dataset.permanent).toBe('true')
      expect(tooltip.dataset.direction).toBe('center')
    }
  })

  it('renders region names in tooltips', () => {
    const { getAllByTestId } = render(<RegionOverlays show={true} />)
    const tooltips = getAllByTestId('tooltip')
    const names = tooltips.map((t) => t.textContent)
    expect(names).toContain('Marin County')
    expect(names).toContain('San Francisco')
    expect(names).toContain('Peninsula')
    expect(names).toContain('South Bay')
    expect(names).toContain('East Bay')
    expect(names).toContain('Napa / Sonoma')
  })
})
