/**
 * GeoSummaryCards - Summary statistics for geographic distribution.
 */

import { MapPin, Building2, Heart, TrendingUp } from "lucide-react";

interface GeoSummaryCardsProps {
  cityCount: number;
  schoolCount: number;
  synagogueCount: number;
  topLocation?:
    | {
        name: string;
        count: number;
        percentage: number;
        category: "city" | "school" | "synagogue";
      }
    | undefined;
}

export function GeoSummaryCards({
  cityCount,
  schoolCount,
  synagogueCount,
  topLocation,
}: GeoSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Cities */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <MapPin className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {cityCount}
            </div>
            <div className="text-sm text-muted-foreground">Cities</div>
          </div>
        </div>
      </div>

      {/* Schools */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Building2 className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {schoolCount}
            </div>
            <div className="text-sm text-muted-foreground">Schools</div>
          </div>
        </div>
      </div>

      {/* Synagogues */}
      <div className="card-lodge p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Heart className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {synagogueCount}
            </div>
            <div className="text-sm text-muted-foreground">Synagogues</div>
          </div>
        </div>
      </div>

      {/* Top Location */}
      {topLocation && (
        <div className="card-lodge p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div
                className="text-lg font-bold text-foreground truncate"
                title={topLocation.name}
              >
                {topLocation.name}
              </div>
              <div className="text-sm text-muted-foreground">
                {topLocation.percentage.toFixed(0)}% of campers
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GeoSummaryCards;
