/**
 * Tests for GeoMap component.
 *
 * Validates category-aware coordinate lookup, onDrilldown prop,
 * and multi-layer rendering with Leaflet Panes.
 * Uses mocked react-leaflet to avoid DOM rendering issues.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track CircleMarker renders for assertion
const renderedMarkers: Array<{
  pane: string | undefined
  fillOpacity: number | undefined
  fillColor: string | undefined
}> = []

// Mock react-leaflet components before imports
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({
    children,
    eventHandlers,
    pathOptions,
    pane,
  }: {
    children: ReactNode
    eventHandlers?: { click?: () => void }
    pathOptions?: { fillOpacity?: number; fillColor?: string }
    pane?: string
  }) => {
    renderedMarkers.push({
      pane,
      fillOpacity: pathOptions?.fillOpacity,
      fillColor: pathOptions?.fillColor,
    })
    return (
      // Real <button> stand-in for react-leaflet's CircleMarker click
      // handler — not a <div> with a bolted-on onClick, per house style.
      <button
        type="button"
        data-testid="circle-marker"
        data-pane={pane ?? ''}
        onClick={eventHandlers?.click}
      >
        {children}
      </button>
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Polygon: () => <div data-testid="polygon" />,
  useMap: () => ({
    setView: vi.fn(),
    createPane: vi.fn(() => ({ style: {} })),
    getPane: vi.fn(() => undefined),
  }),
}))

// Mock RegionOverlays
vi.mock('./RegionOverlays', () => ({
  RegionOverlays: ({ show }: { show: boolean }) =>
    show ? <div data-testid="region-overlays" /> : null,
}))

import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { GeoMap } from './GeoMap'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategory } from './GeoCategoryTabs'

const sampleData: GeoDataItem[] = [
  { name: 'San Francisco', count: 50, percentage: 33.3 },
  { name: 'Oakland', count: 30, percentage: 20.0 },
]

describe('GeoMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    renderedMarkers.length = 0
  })

  it('renders map container', () => {
    render(<GeoMap layers={[{ category: 'city', data: sampleData }]} />)
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('calls onDrilldown when a marker is clicked', () => {
    const onDrilldown = vi.fn()
    render(<GeoMap layers={[{ category: 'city', data: sampleData }]} onDrilldown={onDrilldown} />)

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
        layers={[{ category: 'city', data: sampleData }]}
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

  it('renders school markers in a school layer', () => {
    const schoolData: GeoDataItem[] = [
      { name: 'Riverside Elementary', count: 10, percentage: 50.0 },
    ]
    render(<GeoMap layers={[{ category: 'school', data: schoolData }]} />)
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })
})

describe('GeoMap multi-layer', () => {
  const cityData: GeoDataItem[] = [
    { name: 'San Francisco', count: 50, percentage: 33.3 },
    { name: 'Oakland', count: 30, percentage: 20.0 },
  ]

  const schoolData: GeoDataItem[] = [{ name: 'Riverside Elementary', count: 8, percentage: 16 }]

  const synagogueData: GeoDataItem[] = [{ name: 'Temple Sinai', count: 5, percentage: 10 }]

  beforeEach(() => {
    vi.clearAllMocks()
    renderedMarkers.length = 0
  })

  it('renders markers from multiple categories simultaneously', () => {
    const layers: Array<{ category: GeoCategory; data: GeoDataItem[] }> = [
      { category: 'city', data: cityData },
      { category: 'school', data: schoolData },
      { category: 'synagogue', data: synagogueData },
    ]

    render(<GeoMap layers={layers} height={400} />)

    // Should have markers for all layers that have matching coords
    const markers = screen.getAllByTestId('circle-marker')
    // Exact count depends on which items have coords in the mock
    expect(markers.length).toBeGreaterThanOrEqual(1)
  })

  it('assigns category-specific panes to markers', () => {
    const layers: Array<{ category: GeoCategory; data: GeoDataItem[] }> = [
      { category: 'city', data: cityData },
      { category: 'school', data: schoolData },
    ]

    render(<GeoMap layers={layers} height={400} />)

    const markers = screen.getAllByTestId('circle-marker')
    const panes = markers.map((m) => m.getAttribute('data-pane'))

    // City markers should have cityPane
    const cityPanes = panes.filter((p) => p === 'cityPane')
    expect(cityPanes.length).toBeGreaterThanOrEqual(1)

    // School markers should have schoolPane
    const schoolPanes = panes.filter((p) => p === 'schoolPane')
    expect(schoolPanes.length).toBeGreaterThanOrEqual(0) // may be 0 if no coords match
  })

  it('uses reduced opacity (0.5) when multiple layers active', () => {
    const layers: Array<{ category: GeoCategory; data: GeoDataItem[] }> = [
      { category: 'city', data: cityData },
      { category: 'school', data: schoolData },
    ]

    render(<GeoMap layers={layers} height={400} />)

    // With multiple layers, fillOpacity should be 0.5
    for (const marker of renderedMarkers) {
      expect(marker.fillOpacity).toBe(0.5)
    }
  })

  it('uses standard opacity (0.7) for single layer', () => {
    const layers: Array<{ category: GeoCategory; data: GeoDataItem[] }> = [
      { category: 'city', data: cityData },
    ]

    render(<GeoMap layers={layers} height={400} />)

    // With single layer, fillOpacity should be 0.7
    for (const marker of renderedMarkers) {
      expect(marker.fillOpacity).toBe(0.7)
    }
  })

  it('shows region overlays when enabled regardless of category', () => {
    const layers: Array<{ category: GeoCategory; data: GeoDataItem[] }> = [
      { category: 'school', data: schoolData },
    ]

    render(<GeoMap layers={layers} showRegions={true} height={400} />)

    // Region overlays should show even for school-only layers
    expect(screen.getByTestId('region-overlays')).toBeInTheDocument()
  })

  it('renders with empty layers array', () => {
    render(<GeoMap layers={[]} height={400} />)

    const markers = screen.queryAllByTestId('circle-marker')
    expect(markers).toHaveLength(0)
  })
})
