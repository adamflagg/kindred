/**
 * GeoDetailList - Scrollable list of locations with counts.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GeoDataItem } from './GeoMap';
import type { GeoCategory } from './GeoCategoryTabs';

interface GeoDetailListProps {
  data: GeoDataItem[];
  category: GeoCategory;
  selectedItem?: string | null;
  onItemClick?: (name: string) => void;
  /** Max items to show before "show more" */
  initialLimit?: number;
}

const CATEGORY_LABELS: Record<GeoCategory, string> = {
  city: 'City',
  school: 'School',
  synagogue: 'Synagogue',
};

export function GeoDetailList({
  data,
  category,
  selectedItem,
  onItemClick,
  initialLimit = 15,
}: GeoDetailListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const displayData = showAll ? data : data.slice(0, initialLimit);
  const hasMore = data.length > initialLimit;

  return (
    <div className="card-lodge overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">
            {CATEGORY_LABELS[category]}s
          </span>
          <span className="text-sm text-muted-foreground">({data.length})</span>
        </div>
      </button>

      {/* Table */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    {CATEGORY_LABELS[category]}
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground w-20">
                    Count
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground w-16">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayData.map((item) => {
                  const isSelected = selectedItem === item.name;
                  return (
                    <tr
                      key={item.name}
                      onClick={() => onItemClick?.(item.name)}
                      className={`
                        border-t border-border cursor-pointer transition-colors
                        ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'}
                      `}
                    >
                      <td className="px-4 py-2 text-foreground">{item.name}</td>
                      <td className="px-4 py-2 text-right text-foreground font-medium">
                        {item.count}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {item.percentage.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Show More/Less */}
          {hasMore && (
            <div className="px-4 py-2 border-t border-border bg-muted/30">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-sm text-primary hover:text-primary/80 transition-colors"
              >
                {showAll ? 'Show less' : `Show all ${data.length} ${CATEGORY_LABELS[category].toLowerCase()}s`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GeoDetailList;
