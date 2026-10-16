/**
 * RetentionOverview - Pure returning analysis for prior year → current year.
 *
 * Shows:
 * - Summary cards (prior year total, returned, did not return, overall rate)
 * - Retention rate bar charts for all CEO-requested breakdowns
 * - Geographic retention (city, school, synagogue)
 */

import { useMemo, useCallback } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { MetricCard } from '../../../components/metrics/MetricCard'
import type { RetentionRateBarItem } from '../../../types/metrics'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import { CssVerticalRetentionBarChart } from '../../../components/metrics/CssVerticalRetentionBarChart'
import { RetentionRateLineChart } from '../../../components/metrics/RetentionRateLineChart'
import {
  genderToPieData,
  gradeToBarData,
  sessionToBarData,
  priorSessionToBarData,
  cityToBarData,
  schoolToBarData,
  synagogueToBarData,
  summerYearsToBarData,
  firstSummerYearToBarData,
  regionToBarData,
  computeRetentionOutliers,
} from '../../../utils/retentionTransforms'
import { aggregateCityRetentionByRegion, REGION_DISPLAY_NAMES } from '../../../utils/regionUtils'
import {
  buildSessionDateLookup,
  sortSessionDataByDate,
  sortPriorSessionDataByDate,
} from '../../../utils/sessionUtils'
import { OutlierSection } from '../../../components/metrics/RetentionNotableOutliers'
import { schoolChartName, synagogueChartName } from '../../../utils/chartLabels'
import { sessionName } from '../../../utils/sessionName'
import type { DrilldownFilter } from '../../../types/metrics'
import { Loader2 } from 'lucide-react'
import { formatCount, formatPercent, formatRate } from '../../../utils/numberFormat'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { RetentionGenderTable } from '../../../components/metrics/RetentionGenderTable'
import { GenderFallbackLine } from '../../../components/metrics/genderIdentityNotes'
import { genderNote } from '../../../components/metrics/genderNotes'
import { GENDER_DISPLAY_COLORS } from '../../../components/metrics/genderColors'
import { DefinitionNotes, DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { useCompareYearFilter } from '../../../hooks/useCompareYearFilter'
import { formatSignedCount } from '../../../utils/numberFormat'
import { RetentionChange } from '../../../components/metrics/RetentionChange'
import {
  cityPairKey,
  describeRetentionBasis,
  firstSummerPairKeys,
  regionPriorBars,
  retentionCompareView,
  sessionPairKey,
  withPriorRates,
  type RetentionBasis,
} from '../../../utils/retentionCompare'

// P-20 option B (owner, 2026-10-15): the session, school and synagogue charts write
// shorter names on the axis. City and region names are left as they are.
const shortSessionName = (name: string) => sessionName(name, undefined, 'short')

export default function RetentionOverview() {
  const { currentYear } = useCurrentYear()
  const {
    selectedSessionCmId,
    sessions,
    activeSessionTypes,
    durationParam,
    filterOptions,
    includeTeenPipeline,
    scopeHasTeens,
  } = useMetricsSession()
  const priorYear = currentYear - 1

  // The teen-pipeline flag is only meaningful in a teen scope; outside one the
  // backend treats it as inert, so don't let hidden state leak into the hook
  // call or the React Query cache key (mirrors MetricsTypeTabs hiding the toggle).
  const effectiveTeenPipeline = scopeHasTeens && includeTeenPipeline

  // Build date lookups for chronological session sorting (must be before early returns)
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])

  const { setFilter, DrilldownModal } = useDrilldown({
    year: priorYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['enrolled'],
    duration: durationParam,
  })

  const makeRetentionFilter = useCallback(
    (
      type: DrilldownFilter['type'],
      item: RetentionRateBarItem,
      labelPrefix?: string
    ): DrilldownFilter => ({
      type,
      value: item.id !== undefined ? String(item.id) : item.name,
      label: labelPrefix ? `${labelPrefix}${item.name}` : item.name,
      retentionContext: { baseYear: priorYear, compareYear: currentYear },
    }),
    [priorYear, currentYear]
  )

  const { data, isLoading, error, refetch, isPlaceholderData } = useRetentionMetrics(
    priorYear,
    currentYear,
    filterOptions,
    effectiveTeenPipeline
  )

  // #3207 PR 11 (decision 7): last year's retention, read at this season's registration day while
  // it is live and final after. A picked session maps onto last year's list by name.
  const priorFilter = useCompareYearFilter(currentYear, priorYear, filterOptions)
  const { data: prior } = useRetentionMetrics(
    priorYear - 1,
    priorYear,
    priorFilter,
    effectiveTeenPipeline,
    { samePointOf: currentYear }
  )

  // Build date lookup from API response (prior year sessions have start_date)
  const priorSessionDateLookup = useMemo(() => {
    const lookup: Record<string, string> = {}
    for (const s of data?.by_prior_session ?? []) {
      if (s.start_date) lookup[s.prior_session] = s.start_date
    }
    return lookup
  }, [data?.by_prior_session])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading retention data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label="retention" error={error} onRetry={() => void refetch()} />
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No retention data available
      </div>
    )
  }

  const didNotReturn = data.base_year_total - data.returned_count

  // The basis notes come first (#86); the gender note follows them.
  const basis = describeRetentionBasis(prior, {
    year: currentYear,
    base: data.base_year_total,
    returned: data.returned_count,
  })
  const compare = basis ? retentionCompareView(basis, currentYear) : undefined
  const live = basis?.live ?? false
  // With nothing to compare with yet, every chart reads as before (no half-switched page, #87)
  const pair = <T extends RetentionRateBarItem>(
    bars: T[],
    priorBars: RetentionRateBarItem[],
    keyCurrent?: (b: RetentionRateBarItem) => string,
    keyPrior?: (b: RetentionRateBarItem) => string
  ): RetentionRateBarItem[] =>
    compare ? withPriorRates(bars, priorBars, keyCurrent, keyPrior) : bars
  const bySession = (b: RetentionRateBarItem) => sessionPairKey(b.name)

  // Pre-sort session data chronologically before converting to bar data
  const genderPieData = genderToPieData(data.by_gender)
  // #2898 ruling 58: the base season's campers with no identity answer count by the Gender field, said under the
  // gender cards and in the page's notes (none at 0, #73 a), numbered after the basis notes.
  const fallback = data.gender_fallback_count ?? 0
  const genderNoteN = fallback > 0 ? (basis?.notes.length ?? 0) + 1 : undefined
  const gradeBars = pair(gradeToBarData(data.by_grade), gradeToBarData(prior?.by_grade))
  const sessionBars = pair(
    sessionToBarData(sortSessionDataByDate(data.by_session, sessionDateLookup)),
    sessionToBarData(prior?.by_session),
    bySession
  )
  const priorSessionBars = pair(
    priorSessionToBarData(
      sortPriorSessionDataByDate(data.by_prior_session ?? [], priorSessionDateLookup)
    ),
    priorSessionToBarData(prior?.by_prior_session),
    bySession
  )
  const summerYearsBars = pair(
    summerYearsToBarData(data.by_summer_years),
    summerYearsToBarData(prior?.by_summer_years)
  )
  const firstSummerYearBars = pair(
    firstSummerYearToBarData(data.by_first_summer_year),
    firstSummerYearToBarData(prior?.by_first_summer_year),
    firstSummerPairKeys.current,
    firstSummerPairKeys.prior
  )
  const cityBars = pair(cityToBarData(data.by_city), cityToBarData(prior?.by_city), cityPairKey)
  const schoolBars = pair(schoolToBarData(data.by_school), schoolToBarData(prior?.by_school))
  const synagogueBars = pair(
    synagogueToBarData(data.by_synagogue),
    synagogueToBarData(prior?.by_synagogue)
  )
  const regionRetention = aggregateCityRetentionByRegion(data.by_city ?? [])
  const regionBars = pair(
    regionToBarData(regionRetention).map((b) => ({
      ...b,
      name: REGION_DISPLAY_NAMES[b.name] ?? b.name,
    })),
    regionPriorBars(prior?.by_city)
  )

  const cityOutliers = computeRetentionOutliers(cityBars, data.overall_retention_rate)
  const schoolOutliers = computeRetentionOutliers(schoolBars, data.overall_retention_rate)
  const synagogueOutliers = computeRetentionOutliers(synagogueBars, data.overall_retention_rate)
  const regionOutliers = computeRetentionOutliers(regionBars, data.overall_retention_rate)

  return (
    <MetricsBusy busy={isPlaceholderData} what={String(currentYear)}>
      <div className="space-y-6">
        {basis && <BasisSentence basis={basis} />}

        {/* Summary Cards */}
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
          data-tour="retention-summary-cards"
        >
          <MetricCard
            title={`${priorYear} Total Campers`}
            value={data.base_year_total}
            subtitle="Enrolled in prior year"
            onClick={() =>
              setFilter({
                type: 'retention_all',
                value: 'all',
                label: `${priorYear} Enrolled Campers`,
                retentionContext: { baseYear: priorYear, compareYear: currentYear },
              })
            }
          />
          <MetricCard
            title={`Returned to ${currentYear}`}
            value={data.returned_count}
            subtitle={`${formatRate(data.overall_retention_rate)} ${live ? 'retention so far' : 'retention rate'}`}
            detail={
              live && prior
                ? `${priorYear} had ${formatCount(prior.returned_count)} by this day of ${priorYear} (${formatSignedCount(data.returned_count - prior.returned_count)})`
                : undefined
            }
            onClick={() =>
              setFilter({
                type: 'retention_returned',
                value: 'all',
                label: `Returned to ${currentYear}`,
                retentionContext: { baseYear: priorYear, compareYear: currentYear },
              })
            }
          />
          <MetricCard
            // #88: while registration is open these campers still can return
            title={live ? 'Not yet returned' : 'Did Not Return'}
            value={didNotReturn}
            subtitle={
              live
                ? 'Still can; registration is open'
                : `${formatPercent(data.base_year_total > 0 ? (didNotReturn / data.base_year_total) * 100 : 0)} attrition`
            }
            onClick={() =>
              setFilter({
                type: 'retention_not_returned',
                value: 'all',
                label: `Did Not Return to ${currentYear}`,
                retentionContext: { baseYear: priorYear, compareYear: currentYear },
              })
            }
          />
          <MetricCard
            title="Overall Retention Rate"
            value={formatRate(data.overall_retention_rate)}
            subtitle={`${priorYear} → ${currentYear}`}
            // #84 / #85: the change replaces Good / Low, in both states; nothing while it loads
            badge={
              compare && prior ? (
                <>
                  <RetentionChange
                    rate={data.overall_retention_rate}
                    priorRate={prior.overall_retention_rate}
                    baseCount={data.base_year_total}
                    compare={compare}
                    suffix={live ? '' : ' vs final'}
                  />
                  <DefRef n={compare.noteN} />
                </>
              ) : undefined
            }
          />
        </div>

        {(() => {
          const effectiveOn = effectiveTeenPipeline
          const gradeTenInBase = data.by_grade.find((g) => g.grade === 10)?.base_count ?? 0
          const agedOut = data.aged_out_count ?? 0
          // Split the aged-out total into its two reasons
          const tenthExcluded = effectiveOn ? 0 : scopeHasTeens ? gradeTenInBase : agedOut
          const gradExcluded = effectiveOn ? agedOut : Math.max(0, agedOut - tenthExcluded)

          if (tenthExcluded === 0 && gradExcluded === 0) return null

          const graderS = (n: number) => `grader${n === 1 ? '' : 's'}`

          let noteContent: React.ReactNode
          if (tenthExcluded > 0 && gradExcluded > 0) {
            noteContent = (
              <>
                Excluding {formatCount(tenthExcluded)} rising 10th {graderS(tenthExcluded)} and{' '}
                {formatCount(gradExcluded)} rising 12th {graderS(gradExcluded)}. Only showing
                retention within camp sessions or teen programs — check the box above to include
                10th grader retention stats.
              </>
            )
          } else if (tenthExcluded > 0) {
            if (scopeHasTeens) {
              noteContent = (
                <>
                  Excluding {formatCount(tenthExcluded)} rising 10th {graderS(tenthExcluded)}. Only
                  showing retention within camp sessions or teen programs — check the box above to
                  include 10th grader retention stats.
                </>
              )
            } else {
              noteContent = (
                <>
                  Excluding {formatCount(tenthExcluded)} rising 10th {graderS(tenthExcluded)}.
                </>
              )
            }
          } else {
            noteContent = (
              <>
                Excluding {formatCount(gradExcluded)} rising 12th {graderS(gradExcluded)}.
              </>
            )
          }

          return <p className="text-muted-foreground text-xs">{noteContent}</p>
        })()}

        {/* Row 1: Gender + Grade side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" data-tour="retention-demographics">
          {genderPieData.length > 0 && (
            <BreakdownChart
              data={genderPieData}
              title="Returning Campers by Gender"
              showPercentage
              height={200}
              breakdownType="gender"
              colorMap={GENDER_DISPLAY_COLORS}
              footer={
                genderNoteN !== undefined && (
                  // The pie holds the campers who returned, so its line counts them (#72 a)
                  <GenderFallbackLine
                    n={genderNoteN}
                    count={data.gender_fallback_returned_count ?? 0}
                    season={`${priorYear} campers who returned`}
                  />
                )
              }
              onSegmentClick={(filter) =>
                setFilter({
                  ...filter,
                  retentionContext: { baseYear: priorYear, compareYear: currentYear },
                })
              }
            />
          )}
          {gradeBars.length > 0 && (
            <RetentionRateLineChart
              data={gradeBars}
              title="Retention by Grade"
              tooltipLabelPrefix="Grade "
              compare={compare}
              onDotClick={(item) => setFilter(makeRetentionFilter('grade', item, 'Grade '))}
            />
          )}
        </div>

        {data.by_gender.length > 0 && (
          <RetentionGenderTable
            data={data}
            baseYear={priorYear}
            compareYear={currentYear}
            noteN={genderNoteN}
            prior={compare ? prior : undefined}
            compare={compare}
          />
        )}

        {/* Row 2: Session charts side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {sessionBars.length > 0 && (
            <CssVerticalRetentionBarChart
              data={sessionBars}
              title={`Retention by ${currentYear} Session`}
              sortBy="none"
              barWidthPercent={88}
              shortenLabel={shortSessionName}
              compare={compare}
              onBarClick={(item) => setFilter(makeRetentionFilter('retention_session', item))}
            />
          )}
          {priorSessionBars.length > 0 && (
            <CssVerticalRetentionBarChart
              data={priorSessionBars}
              title={`Retention by ${priorYear} Session`}
              sortBy="none"
              barWidthPercent={88}
              shortenLabel={shortSessionName}
              compare={compare}
            />
          )}
        </div>

        {/* Row 3: Summers at Camp + First Summer Year side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {summerYearsBars.length > 0 && (
            <RetentionRateLineChart
              data={summerYearsBars}
              title="Retention by Summers at Camp"
              compare={compare}
              onDotClick={(item) => setFilter(makeRetentionFilter('summer_years', item))}
            />
          )}
          {firstSummerYearBars.length > 0 && (
            <RetentionRateLineChart
              data={firstSummerYearBars}
              title="Retention by First Summer Year"
              compare={compare}
              onDotClick={(item) => setFilter(makeRetentionFilter('first_summer_year', item))}
            />
          )}
        </div>

        {/* Row 5: City chart + outliers */}
        {cityBars.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" data-tour="retention-geographic">
            <div className={cityOutliers.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CssVerticalRetentionBarChart
                data={cityBars}
                title="Retention by City (Top 15)"
                topN={15}
                sortBy="count"
                barWidthPercent={78}
                compare={compare}
                onBarClick={(item) => setFilter(makeRetentionFilter('city', item))}
              />
            </div>
            <OutlierSection outliers={cityOutliers} max={5} />
          </div>
        )}

        {/* Row 6: School chart + outliers */}
        {schoolBars.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={schoolOutliers.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CssVerticalRetentionBarChart
                data={schoolBars}
                title="Retention by School (Top 15)"
                topN={15}
                sortBy="count"
                barWidthPercent={78}
                compare={compare}
                shortenLabel={schoolChartName}
                onBarClick={(item) => setFilter(makeRetentionFilter('school', item))}
              />
            </div>
            <OutlierSection outliers={schoolOutliers} max={5} />
          </div>
        )}

        {/* Row 7: Synagogue chart + outliers */}
        {synagogueBars.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={synagogueOutliers.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CssVerticalRetentionBarChart
                data={synagogueBars}
                title="Retention by Synagogue (Top 15)"
                topN={15}
                sortBy="count"
                barWidthPercent={78}
                compare={compare}
                shortenLabel={synagogueChartName}
                onBarClick={(item) => setFilter(makeRetentionFilter('synagogue', item))}
              />
            </div>
            <OutlierSection outliers={synagogueOutliers} max={5} />
          </div>
        )}

        {/* Row 8: Region chart + outliers */}
        {regionBars.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={regionOutliers.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CssVerticalRetentionBarChart
                data={regionBars}
                title="Retention by Region"
                sortBy="count"
                barWidthPercent={80}
                compare={compare}
              />
            </div>
            <OutlierSection outliers={regionOutliers} max={5} />
          </div>
        )}

        <DefinitionNotes
          notes={[
            ...(basis?.notes ?? []),
            ...(genderNoteN !== undefined
              ? [
                  genderNote(
                    genderNoteN,
                    [{ season: priorYear, count: fallback }],
                    ' Read for the base season.'
                  ),
                ]
              : []),
          ]}
        />

        {/* Drilldown Modal */}
        <DrilldownModal />
      </div>
    </MetricsBusy>
  )
}

/**
 * The basis under the title (#86): "vs same point last year. Compared with 2025 as it stood on
 * Oct 16, 2025¹, the same registration day² as today." Mark 2 only when the priority-day note is listed.
 */
function BasisSentence({ basis }: { basis: RetentionBasis }) {
  const [first, second] = basis.notes
  let body: React.ReactNode = basis.text
  if (basis.live && basis.day && first) {
    const at = basis.text.indexOf(basis.day) + basis.day.length
    const rest = basis.text.slice(at)
    const dayWord = 'registration day'
    const cut = second ? rest.indexOf(dayWord) : -1
    const secondN = second?.n
    body = (
      <>
        {basis.text.slice(0, at)}
        <DefRef n={first.n} />
        {cut >= 0 && secondN !== undefined ? (
          <>
            {rest.slice(0, cut + dayWord.length)}
            <DefRef n={secondN} />
            {rest.slice(cut + dayWord.length)}
          </>
        ) : (
          rest
        )}
      </>
    )
  }
  return (
    <p className="text-muted-foreground text-sm">
      <b className="text-foreground font-semibold">{basis.label}.</b> {body}
    </p>
  )
}
