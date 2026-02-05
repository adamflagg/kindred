/**
 * GeoAnalysis - Geographic breakdown of registration data.
 *
 * Shows city, school, and synagogue distribution on an interactive map
 * with detailed lists below. Uses attendees/persons data directly for
 * live updates without requiring camper_history sync.
 */

import { useState, useMemo } from 'react'
import { Globe, Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRegistrationMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import {
  GeoMap,
  GeoCategoryTabs,
  GeoSummaryCards,
  GeoDetailList,
  type GeoCategory,
  type GeoDataItem,
} from '../../../components/metrics/geo'

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag']

/** Default status filter for enrolled campers */
const DEFAULT_STATUS_FILTER = ['enrolled']

export default function GeoAnalysis() {
  const { currentYear } = useCurrentYear()
  const [activeCategory, setActiveCategory] = useState<GeoCategory>('city')
  const [selectedItem, setSelectedItem] = useState<string | null>(null)

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId } = useMetricsSession()

  // Drilldown hook for modal functionality
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: DEFAULT_SESSION_TYPES,
    statusFilter: DEFAULT_STATUS_FILTER,
  })

  // Fetch registration data with geographic breakdowns
  const sessionTypesParam = DEFAULT_SESSION_TYPES.join(',')
  const { data, isLoading, error } = useRegistrationMetrics(
    currentYear,
    sessionTypesParam,
    'enrolled',
    selectedSessionCmId ?? undefined
  )

  // Transform data for display
  const geoData = useMemo(() => {
    if (!data) {
      return {
        city: [] as GeoDataItem[],
        school: [] as GeoDataItem[],
        synagogue: [] as GeoDataItem[],
      }
    }

    // Sort by count descending
    const sortByCount = (a: GeoDataItem, b: GeoDataItem) => b.count - a.count

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
    }
  }, [data])

  // Get top location across all categories
  const topLocation = useMemo(() => {
    const allItems = [
      ...geoData.city.map((d) => ({ ...d, category: 'city' as const })),
      ...geoData.school.map((d) => ({ ...d, category: 'school' as const })),
      ...geoData.synagogue.map((d) => ({
        ...d,
        category: 'synagogue' as const,
      })),
    ]

    if (allItems.length === 0) return undefined

    return allItems.reduce((max, item) => (item.count > max.count ? item : max))
  }, [geoData])

  // Handle marker/row click
  const handleItemClick = (name: string) => {
    setSelectedItem((prev) => (prev === name ? null : name))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading geographic data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load geographic data: {error.message}</span>
      </div>
    )
  }

  const currentData = geoData[activeCategory]
  const hasData = currentData.length > 0
  const anyData =
    geoData.city.length > 0 || geoData.school.length > 0 || geoData.synagogue.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold">
          <Globe className="text-primary h-6 w-6" />
          Geographic Analysis
        </h1>
        <p className="text-muted-foreground mt-1">Explore where your campers come from</p>
      </div>

      {!anyData ? (
        /* Empty state when no data at all */
        <div className="card-lodge p-8 text-center">
          <Globe className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h2 className="text-foreground mb-2 text-lg font-semibold">No Geographic Data</h2>
          <p className="text-muted-foreground">
            Geographic breakdown data is not yet available for {currentYear}.
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Make sure person records have school and address information populated.
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
              setActiveCategory(cat)
              setSelectedItem(null)
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
                onDrilldown={setFilter}
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

      {/* Drilldown Modal */}
      <DrilldownModal />
    </div>
  )
}
