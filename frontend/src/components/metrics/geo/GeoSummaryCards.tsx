/**
 * GeoSummaryCards - Summary statistics for geographic distribution.
 */

import { MapPin, Building2, Heart, TrendingUp } from 'lucide-react'

interface GeoSummaryCardsProps {
  cityCount: number
  schoolCount: number
  synagogueCount: number
  topLocation?:
    | {
        name: string
        count: number
        percentage: number
        category: 'city' | 'school' | 'synagogue'
      }
    | undefined
}

export function GeoSummaryCards({
  cityCount,
  schoolCount,
  synagogueCount,
  topLocation,
}: GeoSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* Cities */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2">
            <MapPin className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <div className="text-foreground text-2xl font-bold">{cityCount}</div>
            <div className="text-muted-foreground text-sm">Cities</div>
          </div>
        </div>
      </div>

      {/* Schools */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2">
            <Building2 className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <div className="text-foreground text-2xl font-bold">{schoolCount}</div>
            <div className="text-muted-foreground text-sm">Schools</div>
          </div>
        </div>
      </div>

      {/* Synagogues */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <Heart className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <div className="text-foreground text-2xl font-bold">{synagogueCount}</div>
            <div className="text-muted-foreground text-sm">Synagogues</div>
          </div>
        </div>
      </div>

      {/* Top Location */}
      {topLocation && (
        <div className="card-lodge p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <TrendingUp className="text-primary h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-foreground truncate text-lg font-bold" title={topLocation.name}>
                {topLocation.name}
              </div>
              <div className="text-muted-foreground text-sm">
                {topLocation.percentage.toFixed(0)}% of campers
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GeoSummaryCards
