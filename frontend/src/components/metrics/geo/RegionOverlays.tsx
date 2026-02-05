/**
 * RegionOverlays - Semi-transparent Bay Area region polygons for the GeoMap.
 *
 * Renders 6 region zones with permanent center-positioned labels.
 */

import { Polygon, Tooltip } from 'react-leaflet'
import {
  BAY_AREA_REGION_POLYGONS,
  REGION_COLORS,
  type RegionPolygon,
} from '../../../data/californiaGeo'

interface RegionOverlaysProps {
  show: boolean
}

const regionKeys = Object.keys(BAY_AREA_REGION_POLYGONS) as Array<
  keyof typeof BAY_AREA_REGION_POLYGONS
>

export function RegionOverlays({ show }: RegionOverlaysProps) {
  if (!show) return null

  return (
    <>
      {regionKeys.map((key) => {
        const region: RegionPolygon = BAY_AREA_REGION_POLYGONS[key]
        const colors = REGION_COLORS[key]

        return (
          <Polygon
            key={key}
            positions={region.polygon}
            pathOptions={{
              fillColor: colors.fill,
              fillOpacity: 0.1,
              color: colors.stroke,
              weight: 1.5,
              opacity: 0.3,
              interactive: false,
            }}
          >
            <Tooltip permanent direction="center" className="region-label">
              {region.name}
            </Tooltip>
          </Polygon>
        )
      })}
    </>
  )
}
