/**
 * GeoLayerToggles - Checkbox toggles for geographic data layers.
 *
 * Replaces GeoCategoryTabs with simultaneous multi-layer visibility.
 * Three data layers (cities, schools, synagogues) plus region zones.
 */

import { MapPin, Building2, Heart, Map } from 'lucide-react'
import type { GeoCategoryExtended } from './GeoCategoryTabs'

export interface GeoLayerTogglesProps {
  activeLayers: Set<GeoCategoryExtended>
  onToggleLayer: (category: GeoCategoryExtended) => void
  counts: Record<GeoCategoryExtended, number>
  showRegions: boolean
  onToggleRegions: () => void
}

const LAYERS: Array<{
  id: GeoCategoryExtended
  label: string
  icon: typeof MapPin
  accent: string
}> = [
  { id: 'city', label: 'Cities', icon: MapPin, accent: 'text-blue-500' },
  { id: 'school', label: 'Schools', icon: Building2, accent: 'text-emerald-500' },
  { id: 'synagogue', label: 'Synagogues', icon: Heart, accent: 'text-amber-500' },
  { id: 'region', label: 'Regions', icon: Map, accent: 'text-violet-500' },
]

export function GeoLayerToggles({
  activeLayers,
  onToggleLayer,
  counts,
  showRegions,
  onToggleRegions,
}: GeoLayerTogglesProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Data layer toggles */}
      {LAYERS.map((layer) => {
        const Icon = layer.icon
        const checked = activeLayers.has(layer.id)
        return (
          <label key={layer.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleLayer(layer.id)}
              className="text-primary focus:ring-primary h-4 w-4 rounded border-gray-300"
            />
            <Icon className={`h-3.5 w-3.5 ${layer.accent}`} />
            <span className={checked ? 'text-foreground' : 'text-muted-foreground'}>
              {layer.label}
            </span>
            <span className="text-muted-foreground text-xs">({counts[layer.id]})</span>
          </label>
        )
      })}

      {/* Divider */}
      <div className="bg-border hidden h-5 w-px sm:block" />

      {/* Secondary toggles */}
      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={showRegions}
          onChange={onToggleRegions}
          className="text-primary focus:ring-primary h-4 w-4 rounded border-gray-300"
        />
        <span className="text-muted-foreground">Region zones</span>
      </label>
    </div>
  )
}
