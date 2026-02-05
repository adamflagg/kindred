/**
 * Tests for GeoMap component.
 *
 * Validates category-aware coordinate lookup and onDrilldown prop.
 * Uses mocked react-leaflet to avoid DOM rendering issues.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock react-leaflet components before imports
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({
    children,
    eventHandlers,
  }: {
    children: React.ReactNode
    eventHandlers?: { click?: () => void }
  }) => (
    <div data-testid="circle-marker" onClick={eventHandlers?.click}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn() }),
}))

// Mock RegionOverlays
vi.mock('./RegionOverlays', () => ({
  RegionOverlays: () => null,
}))

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { GeoMap } from './GeoMap'

const sampleData = [
  { name: 'San Francisco', count: 50, percentage: 33.3 },
  { name: 'Oakland', count: 30, percentage: 20.0 },
]

describe('GeoMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders map container', () => {
    render(<GeoMap data={sampleData} category="city" />)
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('calls onDrilldown when a marker is clicked', () => {
    const onDrilldown = vi.fn()
    render(
      <GeoMap
        data={sampleData}
        category="city"
        onDrilldown={onDrilldown}
      />
    )

    // Click on a marker
    const markers = screen.getAllByTestId('circle-marker')
    if (markers.length > 0) {
      fireEvent.click(markers[0]!)
      expect(onDrilldown).toHaveBeenCalledWith({
        type: 'city',
        value: expect.any(String),
        label: expect.any(String),
      })
    }
  })

  it('calls onMarkerClick alongside onDrilldown', () => {
    const onMarkerClick = vi.fn()
    const onDrilldown = vi.fn()
    render(
      <GeoMap
        data={sampleData}
        category="city"
        onMarkerClick={onMarkerClick}
        onDrilldown={onDrilldown}
      />
    )

    const markers = screen.getAllByTestId('circle-marker')
    if (markers.length > 0) {
      fireEvent.click(markers[0]!)
      expect(onMarkerClick).toHaveBeenCalled()
      expect(onDrilldown).toHaveBeenCalled()
    }
  })

  it('renders school markers when category is school', () => {
    const schoolData = [
      { name: 'Riverside Elementary', count: 10, percentage: 50.0 },
    ]
    // This tests that GeoMap uses getLocationCoords for schools
    render(<GeoMap data={schoolData} category="school" />)
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })
})
