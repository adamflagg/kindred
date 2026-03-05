/**
 * GeoMap - Interactive Leaflet map showing geographic distribution.
 *
 * Displays circle markers sized by count for cities, schools, and/or synagogues.
 * Supports multiple simultaneous layers using Leaflet Panes for clean stacking.
 * Uses OpenStreetMap tiles with CartoDB Positron styling for a clean look.
 */

import { useEffect, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  BAY_AREA_CENTER,
  BAY_AREA_ZOOM,
  REGION_COLORS,
  type LatLng,
} from '../../../data/californiaGeo'
import { getLocationCoordsWithOverrides } from '../../../data/geoCoords'
import type { DrilldownFilter } from '../../../types/metrics'
import { RegionOverlays } from './RegionOverlays'
import type { GeoCategory } from './GeoCategoryTabs'

export interface GeoDataItem {
  name: string
  count: number
  percentage: number
}

export interface GeoMapLayer {
  category: GeoCategory
  data: GeoDataItem[]
}

export interface GeoMapProps {
  /** Layers to display on map (multiple categories simultaneously) */
  layers: GeoMapLayer[]
  /** Callback when a marker is clicked */
  onMarkerClick?: (name: string) => void
  /** Callback for drilldown when a marker is clicked */
  onDrilldown?: (filter: DrilldownFilter) => void
  /** Currently selected/highlighted item */
  selectedItem?: string | null
  /** Map height in pixels or CSS value */
  height?: number | string
  /** Whether to show region overlay polygons */
  showRegions?: boolean
  /** Override coordinates from geo_overrides, keyed by "category:name" */
  overrideCoords?: Map<string, LatLng> | undefined
}

/** Color palette matching Sierra Lodge theme */
const CATEGORY_COLORS = {
  city: {
    fill: 'hsl(200, 70%, 50%)',
    stroke: 'hsl(200, 80%, 35%)',
    selected: 'hsl(42, 92%, 55%)',
  },
  school: {
    fill: 'hsl(160, 60%, 45%)',
    stroke: 'hsl(160, 70%, 30%)',
    selected: 'hsl(42, 92%, 55%)',
  },
  synagogue: {
    fill: 'hsl(42, 80%, 55%)',
    stroke: 'hsl(42, 90%, 40%)',
    selected: 'hsl(160, 100%, 35%)',
  },
}

/** Pane names and z-index for each category */
const CATEGORY_PANES: Record<GeoCategory, { name: string; zIndex: number }> = {
  city: { name: 'cityPane', zIndex: 410 },
  school: { name: 'schoolPane', zIndex: 420 },
  synagogue: { name: 'synagoguePane', zIndex: 430 },
}

/** Calculate marker radius based on count (min 8, max 35) */
function getMarkerRadius(count: number, maxCount: number): number {
  const minRadius = 8
  const maxRadius = 35
  const normalized = Math.sqrt(count / maxCount) // Square root scale for better perception
  return minRadius + normalized * (maxRadius - minRadius)
}

/** Component to handle map bounds/center changes and create custom panes */
function MapController({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom)
  }, [map, center, zoom])

  // Create custom panes for layer stacking
  useEffect(() => {
    for (const { name, zIndex } of Object.values(CATEGORY_PANES)) {
      if (!map.getPane(name)) {
        const pane = map.createPane(name)
        pane.style.zIndex = String(zIndex)
      }
    }
    // Region pane below markers
    if (!map.getPane('regionPane')) {
      const pane = map.createPane('regionPane')
      pane.style.zIndex = '399'
    }
  }, [map])

  return null
}

export function GeoMap({
  layers,
  onMarkerClick,
  onDrilldown,
  selectedItem,
  height = 575,
  showRegions = true,
  overrideCoords,
}: GeoMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const isMultiLayer = layers.length > 1
  const baseOpacity = isMultiLayer ? 0.5 : 0.7

  // Process all layers: resolve coords, compute max count across all
  const processedLayers = useMemo(() => {
    return layers.map((layer) => {
      const mappable = layer.data
        .map((item) => ({
          ...item,
          coords: getLocationCoordsWithOverrides(layer.category, item.name, overrideCoords),
        }))
        .filter((item): item is GeoDataItem & { coords: LatLng } => item.coords !== undefined)
      const unmappable = layer.data.filter(
        (item) => !getLocationCoordsWithOverrides(layer.category, item.name, overrideCoords)
      )
      return { ...layer, mappable, unmappable }
    })
  }, [layers, overrideCoords])

  // Global max count across all layers for consistent marker sizing
  const maxCount = useMemo(() => {
    return Math.max(...processedLayers.flatMap((l) => l.mappable.map((d) => d.count)), 1)
  }, [processedLayers])

  // Total counts for legend
  const totalMappable = processedLayers.reduce((sum, l) => sum + l.mappable.length, 0)
  const totalUnmappable = processedLayers.reduce((sum, l) => sum + l.unmappable.length, 0)

  return (
    <div className="space-y-4">
      {/* Map Container */}
      <div
        className="border-border shadow-lodge-sm relative z-0 overflow-hidden rounded-xl border"
        style={{ height }}
      >
        <MapContainer
          center={BAY_AREA_CENTER}
          zoom={BAY_AREA_ZOOM}
          className="h-full w-full"
          ref={mapRef}
          scrollWheelZoom={true}
          zoomControl={true}
        >
          {/* CartoDB Positron tiles - clean, muted colors */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />

          <MapController center={BAY_AREA_CENTER} zoom={BAY_AREA_ZOOM} />

          {/* Region overlays - always available when enabled */}
          <RegionOverlays show={showRegions} pane="regionPane" />

          {/* Render markers for each layer */}
          {processedLayers.map((layer) => {
            const colors = CATEGORY_COLORS[layer.category]
            const paneName = CATEGORY_PANES[layer.category].name

            return layer.mappable.map((item) => {
              const isSelected = selectedItem === item.name
              const radius = getMarkerRadius(item.count, maxCount)

              return (
                <CircleMarker
                  key={`${layer.category}-${item.name}`}
                  center={item.coords}
                  radius={radius}
                  pane={paneName}
                  pathOptions={{
                    fillColor: isSelected ? colors.selected : colors.fill,
                    fillOpacity: isSelected ? 0.9 : baseOpacity,
                    color: isSelected ? colors.selected : colors.stroke,
                    weight: isSelected ? 3 : 2,
                  }}
                  eventHandlers={{
                    click: () => {
                      onMarkerClick?.(item.name)
                      onDrilldown?.({
                        type: layer.category,
                        value: item.name,
                        label: item.name,
                      })
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-xs text-gray-600">
                      {item.count} camper{item.count !== 1 ? 's' : ''} ({item.percentage.toFixed(1)}
                      %)
                    </div>
                  </Tooltip>
                </CircleMarker>
              )
            })
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Show color swatch for each active layer */}
          {layers.map((layer) => {
            const colors = CATEGORY_COLORS[layer.category]
            return (
              <div key={layer.category} className="flex items-center gap-1.5">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: colors.fill,
                    border: `2px solid ${colors.stroke}`,
                  }}
                />
                <span className="capitalize">
                  {layer.category === 'synagogue'
                    ? 'synagogues'
                    : `${layer.category === 'city' ? 'cities' : 'schools'}`}
                </span>
              </div>
            )
          })}
          {totalMappable > 0 && (
            <span>
              {totalMappable} location
              {totalMappable !== 1 ? 's' : ''} shown
            </span>
          )}
          {showRegions && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">|</span>
              {Object.entries(REGION_COLORS).map(([key, rc]) => (
                <div key={key} className="flex items-center gap-1">
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: rc.fill, opacity: 0.6 }}
                  />
                </div>
              ))}
              <span className="text-xs">Regions</span>
            </div>
          )}
        </div>
        {totalUnmappable > 0 && (
          <span className="text-xs">
            {totalUnmappable} location
            {totalUnmappable !== 1 ? 's' : ''} not mapped
          </span>
        )}
      </div>
    </div>
  )
}

export default GeoMap
