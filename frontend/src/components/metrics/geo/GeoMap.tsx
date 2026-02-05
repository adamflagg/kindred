/**
 * GeoMap - Interactive Leaflet map showing geographic distribution.
 *
 * Displays circle markers sized by count for cities, schools, or synagogues.
 * Uses OpenStreetMap tiles with CartoDB Positron styling for a clean look.
 */

import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  BAY_AREA_CENTER,
  BAY_AREA_ZOOM,
  REGION_COLORS,
  type LatLng,
} from '../../../data/californiaGeo'
import { getLocationCoords } from '../../../data/geoCoords'
import type { DrilldownFilter } from '../../../types/metrics'
import { RegionOverlays } from './RegionOverlays'

export interface GeoDataItem {
  name: string
  count: number
  percentage: number
}

export interface GeoMapProps {
  /** Data to display on map */
  data: GeoDataItem[]
  /** Category being displayed (affects marker color) */
  category: 'city' | 'school' | 'synagogue'
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

/** Calculate marker radius based on count (min 8, max 35) */
function getMarkerRadius(count: number, maxCount: number): number {
  const minRadius = 8
  const maxRadius = 35
  const normalized = Math.sqrt(count / maxCount) // Square root scale for better perception
  return minRadius + normalized * (maxRadius - minRadius)
}

/** Component to handle map bounds/center changes */
function MapController({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom)
  }, [map, center, zoom])
  return null
}

export function GeoMap({
  data,
  category,
  onMarkerClick,
  onDrilldown,
  selectedItem,
  height = 575,
  showRegions = true,
}: GeoMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const colors = CATEGORY_COLORS[category]

  // Filter data to items with known coordinates (category-aware)
  const mappableData = data
    .map((item) => ({
      ...item,
      coords: getLocationCoords(category, item.name),
    }))
    .filter((item): item is GeoDataItem & { coords: LatLng } => item.coords !== undefined)

  // Items without coordinates (gaps - not in canonical lookup)
  const unmappableData = data.filter((item) => !getLocationCoords(category, item.name))

  // Calculate max count for radius scaling
  const maxCount = Math.max(...mappableData.map((d) => d.count), 1)

  return (
    <div className="space-y-4">
      {/* Map Container */}
      <div
        className="border-border shadow-lodge-sm overflow-hidden rounded-xl border"
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

          {/* Region overlays (city category only) */}
          <RegionOverlays show={showRegions && category === 'city'} />

          {/* Circle markers for each location */}
          {mappableData.map((item) => {
            const isSelected = selectedItem === item.name
            const radius = getMarkerRadius(item.count, maxCount)

            return (
              <CircleMarker
                key={item.name}
                center={item.coords}
                radius={radius}
                pathOptions={{
                  fillColor: isSelected ? colors.selected : colors.fill,
                  fillOpacity: isSelected ? 0.9 : 0.7,
                  color: isSelected ? colors.selected : colors.stroke,
                  weight: isSelected ? 3 : 2,
                }}
                eventHandlers={{
                  click: () => {
                    onMarkerClick?.(item.name)
                    onDrilldown?.({
                      type: category,
                      value: item.name,
                      label: item.name,
                    })
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="text-xs text-gray-600">
                    {item.count} camper{item.count !== 1 ? 's' : ''} ({item.percentage.toFixed(1)}%)
                  </div>
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: colors.fill,
                border: `2px solid ${colors.stroke}`,
              }}
            />
            <span>Size = camper count</span>
          </div>
          {mappableData.length > 0 && (
            <span>
              {mappableData.length} location
              {mappableData.length !== 1 ? 's' : ''} shown
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
        {unmappableData.length > 0 && (
          <span className="text-xs">
            {unmappableData.length} location
            {unmappableData.length !== 1 ? 's' : ''} not mapped
          </span>
        )}
      </div>
    </div>
  )
}

export default GeoMap
