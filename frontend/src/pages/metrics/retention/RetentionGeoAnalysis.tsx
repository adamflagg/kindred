/**
 * RetentionGeoAnalysis - Multi-year geographic comparison for retention.
 *
 * Shows city, school, and synagogue enrollment across years using
 * MultiYearBreakdownChart with notable shifts highlighting.
 */

import { useMemo } from 'react'
import { Globe, Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { MultiYearBreakdownChart } from '../../../components/metrics/MultiYearBreakdownChart'
import type { YearEnrollment } from '../../../types/metrics'

/** Threshold for "notable" shift: min campers in at least one year */
const MIN_CAMPERS = 8
/** Threshold for "notable" shift: minimum absolute change */
const MIN_ABSOLUTE_CHANGE = 5
/** Threshold for "notable" shift: minimum relative change (25%) */
const MIN_RELATIVE_CHANGE = 0.25

interface NotableShift {
  name: string
  fromCount: number
  toCount: number
  absoluteChange: number
  relativeChange: number
  fromYear: number
  toYear: number
}

/**
 * Compute notable shifts for a breakdown across years.
 */
/**
 * Extract a name→count map from a breakdown array.
 */
function extractCountMap(
  yearData: YearEnrollment,
  breakdownKey: 'by_city' | 'by_school' | 'by_synagogue'
): Map<string, number> {
  const map = new Map<string, number>()
  if (breakdownKey === 'by_city') {
    for (const item of yearData.by_city ?? []) {
      if (item.city) map.set(item.city, item.count)
    }
  } else if (breakdownKey === 'by_school') {
    for (const item of yearData.by_school ?? []) {
      if (item.school) map.set(item.school, item.count)
    }
  } else {
    for (const item of yearData.by_synagogue ?? []) {
      if (item.synagogue) map.set(item.synagogue, item.count)
    }
  }
  return map
}

function computeNotableShifts(
  data: YearEnrollment[],
  breakdownKey: 'by_city' | 'by_school' | 'by_synagogue'
): NotableShift[] {
  if (data.length < 2) return []

  const sorted = [...data].sort((a, b) => a.year - b.year)
  const shifts: NotableShift[] = []

  // Compare consecutive years
  for (let i = 0; i < sorted.length - 1; i++) {
    const fromYearData = sorted[i]!
    const toYearData = sorted[i + 1]!

    const fromMap = extractCountMap(fromYearData, breakdownKey)
    const toMap = extractCountMap(toYearData, breakdownKey)

    // Check all categories in either year
    const allKeys = new Set([...fromMap.keys(), ...toMap.keys()])
    for (const key of allKeys) {
      const fromCount = fromMap.get(key) ?? 0
      const toCount = toMap.get(key) ?? 0
      const maxCount = Math.max(fromCount, toCount)
      const absoluteChange = Math.abs(toCount - fromCount)
      const relativeChange = maxCount > 0 ? absoluteChange / maxCount : 0

      if (
        maxCount >= MIN_CAMPERS &&
        absoluteChange >= MIN_ABSOLUTE_CHANGE &&
        relativeChange >= MIN_RELATIVE_CHANGE
      ) {
        shifts.push({
          name: key,
          fromCount,
          toCount,
          absoluteChange,
          relativeChange,
          fromYear: fromYearData.year,
          toYear: toYearData.year,
        })
      }
    }
  }

  // Sort by absolute change descending
  return shifts.sort((a, b) => b.absoluteChange - a.absoluteChange)
}

function NotableShiftsList({ shifts }: { shifts: NotableShift[] }) {
  if (shifts.length === 0) return null

  return (
    <div className="mt-3">
      <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
        Notable Shifts
      </h4>
      <div className="space-y-1">
        {shifts.slice(0, 8).map((shift, idx) => {
          const isIncrease = shift.toCount > shift.fromCount
          const pctStr = `${Math.round(shift.relativeChange * 100)}%`
          return (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="text-foreground font-medium">{shift.name}:</span>
              <span className="text-muted-foreground">
                {shift.fromCount} → {shift.toCount}
              </span>
              <span
                className={
                  isIncrease
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                ({isIncrease ? '+' : '-'}
                {pctStr})
              </span>
              <span className="text-muted-foreground text-xs">
                {shift.fromYear}→{shift.toYear}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function RetentionGeoAnalysis() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, expandedRetention } = useMetricsSession()

  const numYears = expandedRetention ? 5 : 3

  const {
    data: trendsData,
    isLoading,
    error,
  } = useRetentionTrends(currentYear, {
    numYears,
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
  })

  const enrollmentData = useMemo(
    () => trendsData?.enrollment_by_year ?? [],
    [trendsData?.enrollment_by_year]
  )

  const cityShifts = useMemo(
    () => computeNotableShifts(enrollmentData, 'by_city'),
    [enrollmentData]
  )
  const schoolShifts = useMemo(
    () => computeNotableShifts(enrollmentData, 'by_school'),
    [enrollmentData]
  )
  const synagogueShifts = useMemo(
    () => computeNotableShifts(enrollmentData, 'by_synagogue'),
    [enrollmentData]
  )

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

  const hasCityData = enrollmentData.some((y) => (y.by_city?.length ?? 0) > 0)
  const hasSchoolData = enrollmentData.some((y) => (y.by_school?.length ?? 0) > 0)
  const hasSynagogueData = enrollmentData.some((y) => (y.by_synagogue?.length ?? 0) > 0)

  if (!hasCityData && !hasSchoolData && !hasSynagogueData) {
    return (
      <div className="card-lodge p-8 text-center">
        <Globe className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
        <h2 className="text-foreground mb-2 text-lg font-semibold">No Geographic Data</h2>
        <p className="text-muted-foreground">
          Geographic breakdown data is not yet available. Make sure person records have school,
          address, and congregation information populated.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold">
          <Globe className="text-primary h-6 w-6" />
          Geographic Trends
        </h1>
        <p className="text-muted-foreground mt-1">
          Compare enrollment geography across {numYears} years
        </p>
      </div>

      {/* City Chart */}
      {hasCityData && (
        <div>
          <MultiYearBreakdownChart
            data={enrollmentData}
            breakdownKey="by_city"
            labelKey="city"
            title={`City Distribution (Top 15, ${numYears}-Year Comparison)`}
            topN={15}
            height={350}
          />
          <NotableShiftsList shifts={cityShifts} />
        </div>
      )}

      {/* School Chart */}
      {hasSchoolData && (
        <div>
          <MultiYearBreakdownChart
            data={enrollmentData}
            breakdownKey="by_school"
            labelKey="school"
            title={`School Distribution (Top 15, ${numYears}-Year Comparison)`}
            topN={15}
            height={350}
          />
          <NotableShiftsList shifts={schoolShifts} />
        </div>
      )}

      {/* Synagogue Chart */}
      {hasSynagogueData && (
        <div>
          <MultiYearBreakdownChart
            data={enrollmentData}
            breakdownKey="by_synagogue"
            labelKey="synagogue"
            title={`Synagogue Distribution (Top 15, ${numYears}-Year Comparison)`}
            topN={15}
            height={350}
          />
          <NotableShiftsList shifts={synagogueShifts} />
        </div>
      )}
    </div>
  )
}
