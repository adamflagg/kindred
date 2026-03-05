/**
 * GeoAnalysis - Geographic breakdown of registration data.
 *
 * Shows city, school, and synagogue distribution simultaneously with
 * layer toggle checkboxes. Cities display on the map; all three categories
 * show in stacked collapsible detail lists below.
 *
 * Supports year-over-year comparison mode: hides map and shows
 * GeoComparisonDetailList tables when compareYear is active.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Globe, Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import {
  useNormalizedMappings,
  type NormalizedCategory,
  type SourceMapping,
} from '../../../hooks/useNormalizedMappings'
import { useIsAdmin } from '../../../hooks/useIsAdmin'
import {
  GeoMap,
  GeoSummaryCards,
  GeoDetailList,
  GeoLayerToggles,
  GeoGapsList,
  GeoComparisonDetailList,
  type GeoCategory,
  type GeoCategoryExtended,
  type GeoDataItem,
  type GeoMapLayer,
} from '../../../components/metrics/geo'
import { getLocationCoordsWithOverrides } from '../../../data/geoCoords'
import { useGeoOverrideCoords } from '../../../hooks/useGeoOverrideCoords'
import { aggregateCityCountsByRegion, REGION_DISPLAY_NAMES } from '../../../utils/regionUtils'

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
  const isAdmin = useIsAdmin()
  const { data: overrideCoords } = useGeoOverrideCoords(currentYear)
  const [activeLayers, setActiveLayers] = useState<Set<GeoCategoryExtended>>(
    new Set(['city', 'school', 'synagogue', 'region'])
  )
  const [showRegions, setShowRegions] = useState(true)
  const [showSources, setShowSources] = useState(false)
  const [showGaps, setShowGaps] = useState(false)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<GeoCategoryExtended>>(new Set())

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId, sessionTypesParam, activeSessionTypes, compareYear, isComparing } =
    useMetricsSession()

  // Force sources/gaps off when entering compare mode
  useEffect(() => {
    if (isComparing) {
      setShowSources(false)
      setShowGaps(false)
    }
  }, [isComparing])

  // Drilldown hook for modal functionality
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: DEFAULT_STATUS_FILTER,
  })

  // Fetch normalized mappings for source display and gap classification per active layer
  const needsMappings = showSources || showGaps
  const { data: citySources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.city,
    needsMappings && activeLayers.has('city'),
    selectedSessionCmId ?? undefined
  )
  const { data: schoolSources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.school,
    needsMappings && activeLayers.has('school'),
    selectedSessionCmId ?? undefined
  )
  const { data: synagogueSources } = useNormalizedMappings(
    currentYear,
    categoryToDbCategory.synagogue,
    needsMappings && activeLayers.has('synagogue'),
    selectedSessionCmId ?? undefined
  )

  // Fetch registration data with geographic breakdowns + optional comparison
  const { primary, comparison } = useComparisonRegistrationData(
    currentYear,
    compareYear,
    sessionTypesParam,
    'enrolled',
    selectedSessionCmId ?? undefined
  )
  const { data, isLoading, error } = primary
  const compData = comparison?.data

  // Transform data for display
  const geoData = useMemo(() => {
    if (!data) {
      return {
        city: [] as GeoDataItem[],
        school: [] as GeoDataItem[],
        synagogue: [] as GeoDataItem[],
        region: [] as GeoDataItem[],
      }
    }

    const sortByCount = (a: GeoDataItem, b: GeoDataItem) => b.count - a.count

    const regionData = aggregateCityCountsByRegion(data.by_city ?? []).map((r) => ({
      name: REGION_DISPLAY_NAMES[r.region] ?? r.region,
      count: r.count,
      percentage: r.percentage,
    }))

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
      region: regionData,
    }
  }, [data])

  // Build comparison geo data
  const compGeoData = useMemo(() => {
    if (!compData) return null
    const sortByCount = (a: GeoDataItem, b: GeoDataItem) => b.count - a.count
    const regionData = aggregateCityCountsByRegion(compData.by_city ?? []).map((r) => ({
      name: REGION_DISPLAY_NAMES[r.region] ?? r.region,
      count: r.count,
      percentage: r.percentage,
    }))
    return {
      city: (compData.by_city ?? [])
        .map((c) => ({ name: c.city, count: c.count, percentage: c.percentage }))
        .sort(sortByCount),
      school: (compData.by_school ?? [])
        .map((s) => ({ name: s.school, count: s.count, percentage: s.percentage }))
        .sort(sortByCount),
      synagogue: (compData.by_synagogue ?? [])
        .map((s) => ({ name: s.synagogue, count: s.count, percentage: s.percentage }))
        .sort(sortByCount),
      region: regionData,
    }
  }, [compData])

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

  // Compute visible categories for row-pair expand sync
  const visibleCategories = useMemo(
    () =>
      (['city', 'school', 'synagogue', 'region'] as const).filter(
        (cat) => activeLayers.has(cat) && geoData[cat].length > 0
      ),
    [activeLayers, geoData]
  )

  // Find row partner (items at index 0,1 share row 1; items at 2,3 share row 2)
  const getRowPartner = useCallback(
    (cat: GeoCategoryExtended): GeoCategoryExtended | undefined => {
      const idx = visibleCategories.indexOf(cat)
      if (idx === -1) return undefined
      const partnerIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      return visibleCategories[partnerIdx]
    },
    [visibleCategories]
  )

  const handleDetailToggle = useCallback(
    (category: GeoCategoryExtended) => {
      setExpandedCategories((prev) => {
        const next = new Set(prev)
        const partner = getRowPartner(category)
        const isOpening = !prev.has(category)
        if (isOpening) {
          next.add(category)
          if (partner) next.add(partner)
        } else {
          next.delete(category)
          if (partner) next.delete(partner)
        }
        return next
      })
    },
    [getRowPartner]
  )

  // Toggle a data layer on/off
  const handleToggleLayer = useCallback((category: GeoCategoryExtended) => {
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

  // Compute gaps (items without coordinates = not in canonical lookup or overrides)
  const gaps = useMemo(() => {
    const computeGaps = (items: GeoDataItem[], category: GeoCategory) =>
      items.filter((item) => !getLocationCoordsWithOverrides(category, item.name, overrideCoords))

    return {
      city: computeGaps(geoData.city, 'city'),
      school: computeGaps(geoData.school, 'school'),
      synagogue: computeGaps(geoData.synagogue, 'synagogue'),
    }
  }, [geoData, overrideCoords])

  // Source mappings per category
  const sourceMappingsFor: Record<GeoCategory, Map<string, SourceMapping[]> | undefined> = {
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
              region: geoData.region.length,
            }}
            showRegions={showRegions}
            onToggleRegions={() => setShowRegions((v) => !v)}
            showSources={showSources}
            onToggleSources={() => setShowSources((v) => !v)}
            showGaps={showGaps}
            onToggleGaps={() => setShowGaps((v) => !v)}
            isAdmin={isAdmin}
            isComparing={isComparing}
          />

          {/* Map - hidden in comparison mode */}
          {isComparing ? (
            <div className="card-lodge p-6 text-center">
              <p className="text-muted-foreground text-sm">
                Map view is available in single-year mode. Showing comparison tables below.
              </p>
            </div>
          ) : (
            <GeoMap
              layers={(['city', 'school', 'synagogue'] as const)
                .filter((cat) => activeLayers.has(cat) && geoData[cat].length > 0)
                .map((cat): GeoMapLayer => ({ category: cat, data: geoData[cat] }))}
              selectedItem={selectedItem}
              onMarkerClick={handleItemClick}
              onDrilldown={setFilter}
              height={575}
              showRegions={showRegions}
              overrideCoords={overrideCoords}
            />
          )}

          {/* Detail Lists - comparison or single year */}
          {isComparing && compGeoData ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {activeLayers.has('city') &&
                (geoData.city.length > 0 || compGeoData.city.length > 0) && (
                  <GeoComparisonDetailList
                    category="city"
                    primaryData={geoData.city}
                    compareData={compGeoData.city}
                    primaryYear={currentYear}
                    compareYear={compareYear!}
                    isOpen={expandedCategories.has('city')}
                    onToggle={() => handleDetailToggle('city')}
                  />
                )}
              {activeLayers.has('school') &&
                (geoData.school.length > 0 || compGeoData.school.length > 0) && (
                  <GeoComparisonDetailList
                    category="school"
                    primaryData={geoData.school}
                    compareData={compGeoData.school}
                    primaryYear={currentYear}
                    compareYear={compareYear!}
                    isOpen={expandedCategories.has('school')}
                    onToggle={() => handleDetailToggle('school')}
                  />
                )}
              {activeLayers.has('synagogue') &&
                (geoData.synagogue.length > 0 || compGeoData.synagogue.length > 0) && (
                  <GeoComparisonDetailList
                    category="synagogue"
                    primaryData={geoData.synagogue}
                    compareData={compGeoData.synagogue}
                    primaryYear={currentYear}
                    compareYear={compareYear!}
                    isOpen={expandedCategories.has('synagogue')}
                    onToggle={() => handleDetailToggle('synagogue')}
                  />
                )}
              {activeLayers.has('region') &&
                (geoData.region.length > 0 || compGeoData.region.length > 0) && (
                  <GeoComparisonDetailList
                    category="region"
                    primaryData={geoData.region}
                    compareData={compGeoData.region}
                    primaryYear={currentYear}
                    compareYear={compareYear!}
                    isOpen={expandedCategories.has('region')}
                    onToggle={() => handleDetailToggle('region')}
                  />
                )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {activeLayers.has('city') && geoData.city.length > 0 && (
                <GeoDetailList
                  data={geoData.city}
                  category="city"
                  selectedItem={selectedItem}
                  onItemClick={handleItemClick}
                  onDrilldown={setFilter}
                  showSources={showSources}
                  sourceMappings={sourceMappingsFor.city}
                  showGaps={showGaps}
                  isOpen={expandedCategories.has('city')}
                  onToggle={() => handleDetailToggle('city')}
                  overrideCoords={overrideCoords}
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
                  showGaps={showGaps}
                  isOpen={expandedCategories.has('school')}
                  onToggle={() => handleDetailToggle('school')}
                  overrideCoords={overrideCoords}
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
                  showGaps={showGaps}
                  isOpen={expandedCategories.has('synagogue')}
                  onToggle={() => handleDetailToggle('synagogue')}
                  overrideCoords={overrideCoords}
                />
              )}
              {activeLayers.has('region') && geoData.region.length > 0 && (
                <GeoDetailList
                  data={geoData.region}
                  category="region"
                  isOpen={expandedCategories.has('region')}
                  onToggle={() => handleDetailToggle('region')}
                />
              )}
            </div>
          )}

          {/* Gap Tracking (admin only, single-year mode only) */}
          {showGaps && !isComparing && (
            <div className="space-y-3">
              {activeLayers.has('city') && (
                <GeoGapsList
                  gaps={gaps.city}
                  category="city"
                  sourceMappings={sourceMappingsFor.city}
                />
              )}
              {activeLayers.has('school') && (
                <GeoGapsList
                  gaps={gaps.school}
                  category="school"
                  sourceMappings={sourceMappingsFor.school}
                />
              )}
              {activeLayers.has('synagogue') && (
                <GeoGapsList
                  gaps={gaps.synagogue}
                  category="synagogue"
                  sourceMappings={sourceMappingsFor.synagogue}
                />
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
