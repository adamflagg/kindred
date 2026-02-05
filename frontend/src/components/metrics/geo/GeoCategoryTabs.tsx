/**
 * GeoCategoryTabs - Tab selector for City/School/Synagogue views.
 */

import clsx from "clsx";
import { MapPin, Building2, Heart } from "lucide-react";

export type GeoCategory = "city" | "school" | "synagogue";

interface GeoCategoryTabsProps {
  activeCategory: GeoCategory;
  onCategoryChange: (category: GeoCategory) => void;
  counts: {
    city: number;
    school: number;
    synagogue: number;
  };
}

const TABS: Array<{ id: GeoCategory; label: string; icon: typeof MapPin }> = [
  { id: "city", label: "Cities", icon: MapPin },
  { id: "school", label: "Schools", icon: Building2 },
  { id: "synagogue", label: "Synagogues", icon: Heart },
];

export function GeoCategoryTabs({
  activeCategory,
  onCategoryChange,
  counts,
}: GeoCategoryTabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
      {TABS.map((tab) => {
        const isActive = activeCategory === tab.id;
        const Icon = tab.icon;
        const count = counts[tab.id];

        return (
          <button
            key={tab.id}
            onClick={() => onCategoryChange(tab.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
            <span
              className={clsx(
                "px-1.5 py-0.5 rounded text-xs",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default GeoCategoryTabs;
