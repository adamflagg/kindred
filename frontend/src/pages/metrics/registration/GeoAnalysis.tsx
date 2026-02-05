/**
 * GeoAnalysis - Geographic breakdown of registration data.
 *
 * Shows city, school, and synagogue distribution simultaneously with
 * layer toggle checkboxes. Cities display on the map; all three categories
 * show in stacked collapsible detail lists below.
 */

import { useState, useMemo, useCallback } from 'react'
import { Globe, Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRegistrationMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import {
  useNormalizedMappings,
  type NormalizedCategory,
} from '../../../hooks/useNormalizedMappings'
import { useIsAdmin } from '../../../hooks/useIsAdmin'
import {
  GeoMap,
  GeoSummaryCards,
  GeoDetailList,
  GeoLayerToggles,
  GeoGapsList,
  type GeoCategory,
  type GeoDataItem,
  type GeoMapLayer,
} from '../../../components/metrics/geo'
import { getLocationCoords } from '../../../data/geoCoords'

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag']

/** Default status filter for enrolled campers */
const DEFAULT_STATUS_FILTER = ['enrolled']

/** Map frontend category names to DB category names */
const categoryToDbCategory: Record<GeoCategory, NormalizedCategory> = {
  city: 'city',
  school: 'school',
  synagogue: 'congregation',
}

export default function GeoAnalysis() {
  const { currentYear } = useCurrentYear()
  const [activeLayers, setActiveLayers] = useState<Set<GeoCategory>>(
    new Set(['city', 'school', 'synagogue'])
  )
  const [showRegions, setShowRegions] = useState(true)
  const [showSources, setShowSources] = useState(false)
  const [showGaps, setShowGaps] = useState(false)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const isAdmin = useIsAdmin()

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId } = useMetricsSession()

  // Drilldown hook for modal functionality
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: DEFAULT_SESSION_TYPES,
    statusFilter: DEFAULT_STATUS_FILTER,
  })

  // Fetch normalized mappings for source display per active layer
  const { data: citySources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.city,
    showSources && activeLayers.has('city'),
    selectedSessionCmId ?? undefined
  )
  const { data: schoolSources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.school,
    showSources && activeLayers.has('school'),
    selectedSessionCmId ?? undefined
  )
  const { data: synagogueSources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.synagogue,
    showSources && activeLayers.has('synagogue'),
    selectedSessionCmId ?? undefined
  )

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

  // Toggle a data layer on/off
  const handleToggleLayer = useCallback((category: GeoCategory) => {
    setActiveLayers((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  // Handle marker/row click
  const handleItemClick = (name: string) => {
    setSelectedItem((prev) => (prev === name ? null : name))
  }

  // Compute gaps (items without coordinates = not in canonical lookup)
  const gaps = useMemo(() => {
    const computeGaps = (items: GeoDataItem[], category: GeoCategory) =>
      items.filter((item) => !getLocationCoords(category, item.name))

    return {
      city: computeGaps(geoData.city, 'city'),
      school: computeGaps(geoData.school, 'school'),
      synagogue: computeGaps(geoData.synagogue, 'synagogue'),
    }
  }, [geoData])

  // Source mappings per category
  const sourceMappingsFor: Record<
    GeoCategory,
    Map<string, import('../../../hooks/useNormalizedMappings').SourceMapping[]> | undefined
  > = {
    city: citySources,
    school: schoolSources,
    synagogue: synagogueSources,
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

          {/* Layer Toggles */}
          <GeoLayerToggles
            activeLayers={activeLayers}
            onToggleLayer={handleToggleLayer}
            counts={{
              city: geoData.city.length,
              school: geoData.school.length,
              synagogue: geoData.synagogue.length,
            }}
            showRegions={showRegions}
            onToggleRegions={() => setShowRegions((v) => !v)}
            showSources={showSources}
            onToggleSources={() => setShowSources((v) => !v)}
            showGaps={showGaps}
            onToggleGaps={() => setShowGaps((v) => !v)}
            isAdmin={isAdmin}
          />

          {/* Map - shows all active layers simultaneously */}
          <GeoMap
            layers={(['city', 'school', 'synagogue'] as const)
              .filter((cat) => activeLayers.has(cat) && geoData[cat].length > 0)
              .map((cat): GeoMapLayer => ({ category: cat, data: geoData[cat] }))}
            selectedItem={selectedItem}
            onMarkerClick={handleItemClick}
            onDrilldown={setFilter}
            height={575}
            showRegions={showRegions}
          />

          {/* Stacked Detail Lists */}
          <div className="space-y-3">
            {activeLayers.has('city') && geoData.city.length > 0 && (
              <GeoDetailList
                data={geoData.city}
                category="city"
                selectedItem={selectedItem}
                onItemClick={handleItemClick}
                onDrilldown={setFilter}
                showSources={showSources}
                sourceMappings={sourceMappingsFor.city}
              />
            )}
            {activeLayers.has('school') && geoData.school.length > 0 && (
              <GeoDetailList
                data={geoData.school}
                category="school"
                selectedItem={selectedItem}
                onItemClick={handleItemClick}
                onDrilldown={setFilter}
                showSources={showSources}
                sourceMappings={sourceMappingsFor.school}
              />
            )}
            {activeLayers.has('synagogue') && geoData.synagogue.length > 0 && (
              <GeoDetailList
                data={geoData.synagogue}
                category="synagogue"
                selectedItem={selectedItem}
                onItemClick={handleItemClick}
                onDrilldown={setFilter}
                showSources={showSources}
                sourceMappings={sourceMappingsFor.synagogue}
              />
            )}
          </div>

          {/* Gap Tracking (admin only) */}
          {showGaps && (
            <div className="space-y-3">
              {activeLayers.has('city') && <GeoGapsList gaps={gaps.city} category="city" />}
              {activeLayers.has('school') && <GeoGapsList gaps={gaps.school} category="school" />}
              {activeLayers.has('synagogue') && (
                <GeoGapsList gaps={gaps.synagogue} category="synagogue" />
              )}
            </div>
          )}
        </>
      )}

      {/* Drilldown Modal */}
      <DrilldownModal />
    </div>
  )
}
