/**
 * RegionOverlays - Semi-transparent Bay Area region polygons for the GeoMap.
 *
 * Renders 6 region zones as semi-transparent county boundary polygons.
 */

import { Polygon } from 'react-leaflet'
import { BAY_AREA_REGION_POLYGONS, REGION_COLORS } from '../../../data/californiaGeo'

interface RegionOverlaysProps {
  show: boolean
  pane?: string
}

const regionKeys = Object.keys(BAY_AREA_REGION_POLYGONS) as Array<
  keyof typeof BAY_AREA_REGION_POLYGONS
>

export function RegionOverlays({ show, pane }: RegionOverlaysProps) {
  if (!show) return null

  return (
    <>
      {regionKeys.map((key) => {
        const region = BAY_AREA_REGION_POLYGONS[key]
        const colors = REGION_COLORS[key]

        return (
          <Polygon
            key={key}
            positions={region.polygon}
            pane={pane}
            pathOptions={{
              fillColor: colors.fill,
              fillOpacity: 0.1,
              color: colors.stroke,
              weight: 1.5,
              opacity: 0.3,
              interactive: false,
            }}
          />
        )
      })}
    </>
  )
}
