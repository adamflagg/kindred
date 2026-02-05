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
  Polygon: (props: { [key: string]: unknown }) => (
    <div data-testid="polygon" data-positions={JSON.stringify(props['positions'])} />
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

  it('each polygon has positions data', () => {
    const { getAllByTestId } = render(<RegionOverlays show={true} />)
    const polygons = getAllByTestId('polygon')
    for (const polygon of polygons) {
      const positions = polygon.getAttribute('data-positions')
      expect(positions).toBeTruthy()
      const parsed = JSON.parse(positions!)
      expect(parsed.length).toBeGreaterThan(0)
    }
  })
})
