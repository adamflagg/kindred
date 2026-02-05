/**
 * GeoAnalysis - Geographic breakdown of registration data.
 *
 * Shows city, school, and synagogue distribution on an interactive map
 * with detailed lists below. Uses attendees/persons data directly for
 * live updates without requiring camper_history sync.
 */

import { useState, useMemo } from "react";
import { Globe, Loader2, AlertCircle } from "lucide-react";
import { useCurrentYear } from "../../../hooks/useCurrentYear";
import { useRegistrationMetrics } from "../../../hooks/useMetrics";
import { useMetricsSession } from "../../../hooks/useMetricsSession";
import {
  GeoMap,
  GeoCategoryTabs,
  GeoSummaryCards,
  GeoDetailList,
  type GeoCategory,
  type GeoDataItem,
} from "../../../components/metrics/geo";

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ["main", "embedded", "ag"];

export default function GeoAnalysis() {
  const { currentYear } = useCurrentYear();
  const [activeCategory, setActiveCategory] = useState<GeoCategory>("city");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId } = useMetricsSession();

  // Fetch registration data with geographic breakdowns
  const sessionTypesParam = DEFAULT_SESSION_TYPES.join(",");
  const { data, isLoading, error } = useRegistrationMetrics(
    currentYear,
    sessionTypesParam,
    "enrolled",
    selectedSessionCmId ?? undefined,
  );

  // Transform data for display
  const geoData = useMemo(() => {
    if (!data) {
      return {
        city: [] as GeoDataItem[],
        school: [] as GeoDataItem[],
        synagogue: [] as GeoDataItem[],
      };
    }

    // Sort by count descending
    const sortByCount = (a: GeoDataItem, b: GeoDataItem) => b.count - a.count;

    return {
      city: (data.by_city ?? [])
        .map((c) => ({
          name: c.city,
          count: c.count,
          percentage: c.percentage,
        }))
        .sort(sortByCount),
      school: (data.by_school ?? [])
        .map((s) => ({
          name: s.school,
          count: s.count,
          percentage: s.percentage,
        }))
        .sort(sortByCount),
      synagogue: (data.by_synagogue ?? [])
        .map((s) => ({
          name: s.synagogue,
          count: s.count,
          percentage: s.percentage,
        }))
        .sort(sortByCount),
    };
  }, [data]);

  // Get top location across all categories
  const topLocation = useMemo(() => {
    const allItems = [
      ...geoData.city.map((d) => ({ ...d, category: "city" as const })),
      ...geoData.school.map((d) => ({ ...d, category: "school" as const })),
      ...geoData.synagogue.map((d) => ({
        ...d,
        category: "synagogue" as const,
      })),
    ];

    if (allItems.length === 0) return undefined;

    return allItems.reduce((max, item) =>
      item.count > max.count ? item : max,
    );
  }, [geoData]);

  // Handle marker/row click
  const handleItemClick = (name: string) => {
    setSelectedItem((prev) => (prev === name ? null : name));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">
          Loading geographic data...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="w-6 h-6 mr-2" />
        <span>Failed to load geographic data: {error.message}</span>
      </div>
    );
  }

  const currentData = geoData[activeCategory];
  const hasData = currentData.length > 0;
  const anyData =
    geoData.city.length > 0 ||
    geoData.school.length > 0 ||
    geoData.synagogue.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Globe className="w-6 h-6 text-primary" />
          Geographic Analysis
        </h1>
        <p className="text-muted-foreground mt-1">
          Explore where your campers come from
        </p>
      </div>

      {!anyData ? (
        /* Empty state when no data at all */
        <div className="card-lodge p-8 text-center">
          <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            No Geographic Data
          </h2>
          <p className="text-muted-foreground">
            Geographic breakdown data is not yet available for {currentYear}.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Make sure person records have school and address information
            populated.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <GeoSummaryCards
            cityCount={geoData.city.length}
            schoolCount={geoData.school.length}
            synagogueCount={geoData.synagogue.length}
            topLocation={topLocation}
          />

          {/* Category Tabs */}
          <GeoCategoryTabs
            activeCategory={activeCategory}
            onCategoryChange={(cat) => {
              setActiveCategory(cat);
              setSelectedItem(null);
            }}
            counts={{
              city: geoData.city.length,
              school: geoData.school.length,
              synagogue: geoData.synagogue.length,
            }}
          />

          {/* Map and List */}
          {hasData ? (
            <div className="space-y-4">
              {/* Map */}
              <GeoMap
                data={currentData}
                category={activeCategory}
                selectedItem={selectedItem}
                onMarkerClick={handleItemClick}
                height={400}
              />

              {/* Detail List */}
              <GeoDetailList
                data={currentData}
                category={activeCategory}
                selectedItem={selectedItem}
                onItemClick={handleItemClick}
              />
            </div>
          ) : (
            /* Empty state for specific category */
            <div className="card-lodge p-6 text-center">
              <p className="text-muted-foreground">
                No {activeCategory} data available for {currentYear}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
