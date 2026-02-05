/**
 * GeoCategoryTabs - Tab selector for City/School/Synagogue views.
 */

import clsx from 'clsx'
import { MapPin, Building2, Heart } from 'lucide-react'

export type GeoCategory = 'city' | 'school' | 'synagogue'

interface GeoCategoryTabsProps {
  activeCategory: GeoCategory
  onCategoryChange: (category: GeoCategory) => void
  counts: {
    city: number
    school: number
    synagogue: number
  }
}

const TABS: Array<{ id: GeoCategory; label: string; icon: typeof MapPin }> = [
  { id: 'city', label: 'Cities', icon: MapPin },
  { id: 'school', label: 'Schools', icon: Building2 },
  { id: 'synagogue', label: 'Synagogues', icon: Heart },
]

export function GeoCategoryTabs({
  activeCategory,
  onCategoryChange,
  counts,
}: GeoCategoryTabsProps) {
  return (
    <div className="bg-muted/50 flex gap-1 rounded-lg p-1">
      {TABS.map((tab) => {
        const isActive = activeCategory === tab.id
        const Icon = tab.icon
        const count = counts[tab.id]

        return (
          <button
            key={tab.id}
            onClick={() => onCategoryChange(tab.id)}
            className={clsx(
              'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{tab.label}</span>
            <span
              className={clsx(
                'rounded px-1.5 py-0.5 text-xs',
                isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default GeoCategoryTabs
