/**
 * Day1Page - First-24-hour registration analysis per tier opening.
 *
 * Honors the shared metrics session picker (like every other registration
 * page): the picker's session_types flow into the Day 1 query, so "All Summer"
 * includes teens and "Teens" scopes to SCIT/TLI.
 *
 * Shows:
 * - Hero cards (one per tier: priority/early/open) with current year totals
 * - Comparison table with At Camp / Quest / Teens / Total rows across tiers and
 *   years (the Teens row appears only when teen counts are present)
 * - Delta indicators vs prior year
 * - Approximate count indicators when data is reconstructed
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useDay1 } from '../../../hooks/useDay1'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import type { Day1Response, Day1TierData, Day1YearData } from '../../../types/day1'

/** Tier display configuration: label, gradient classes, and text accent */
const TIER_CONFIG: Record<
  string,
  { gradient: string; accent: string; bg: string; border: string }
> = {
  priority: {
    gradient: 'from-purple-600 to-purple-800 dark:from-purple-700 dark:to-purple-900',
    accent: 'text-purple-200',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-800',
  },
  early: {
    gradient: 'from-blue-500 to-blue-700 dark:from-blue-600 dark:to-blue-800',
    accent: 'text-blue-200',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
  },
  open: {
    gradient: 'from-emerald-500 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800',
    accent: 'text-emerald-200',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
}

/** Find a tier in a year's data by tier name */
function findTier(tiers: Day1TierData[], tier: string): Day1TierData | undefined {
  return tiers.find((t) => t.tier === tier)
}

/** Get count for a category within a tier, or null if missing */
function getCategoryCount(tier: Day1TierData | undefined, category: string): number | null {
  if (!tier) return null
  const cat = tier.categories.find((c) => c.category === category)
  return cat ? cat.count : null
}

/** Format a count value */
function fmtCount(value: number | null): string {
  if (value === null) return 'n/a'
  return value.toLocaleString()
}

/** Check if a tier's registration window hasn't started yet */
function isFutureTier(tier: Day1TierData): boolean {
  return new Date(tier.window_start).getTime() > Date.now()
}

/** Format date as "Mon DD" (e.g., "Jan 15") */
function fmtDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Delta arrow and formatting */
function formatDelta(
  current: number | null,
  prior: number | null
): { text: string; color: string } {
  if (current === null || prior === null) return { text: '', color: '' }
  const diff = current - prior
  if (diff === 0) return { text: '0', color: 'text-white/70' }
  const arrow = diff > 0 ? '\u25B2' : '\u25BC'
  const sign = diff > 0 ? '+' : ''
  return {
    text: `${arrow} ${sign}${diff.toLocaleString()}`,
    color: diff > 0 ? 'text-emerald-300' : 'text-red-300',
  }
}

const DEFAULT_TIER_CONFIG = {
  gradient: 'from-emerald-500 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800',
  accent: 'text-emerald-200',
  bg: 'bg-emerald-50 dark:bg-emerald-950/30',
  border: 'border-emerald-200 dark:border-emerald-800',
}

interface HeroCardProps {
  tier: Day1TierData
  priorYears: Day1YearData[]
}

function HeroCard({ tier, priorYears }: HeroCardProps) {
  const config = TIER_CONFIG[tier.tier] ?? DEFAULT_TIER_CONFIG
  const upcoming = isFutureTier(tier)
  const atCamp = getCategoryCount(tier, 'at_camp')
  const quest = getCategoryCount(tier, 'quest')
  const teen = getCategoryCount(tier, 'teen')

  // Find prior year data for delta
  const priorYear = priorYears.length > 0 ? priorYears[0] : undefined
  const priorTier = priorYear ? findTier(priorYear.tiers, tier.tier) : undefined
  const priorTotal = priorTier?.total.count ?? null
  const delta = formatDelta(tier.total.count, priorTotal)

  // Build prior year summary string
  const priorSummaries = priorYears
    .map((py) => {
      const pt = findTier(py.tiers, tier.tier)
      if (!pt) return null
      return `${py.year}: ${pt.total.count.toLocaleString()}`
    })
    .filter(Boolean)

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${config.gradient} p-5 text-white shadow-lg ${upcoming ? 'opacity-60' : ''}`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold">{tier.tier_label}</h3>
          <p className={`text-sm ${config.accent}`}>{fmtDate(tier.date)}</p>
        </div>
        <span className={`rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium`}>
          First 24h
        </span>
      </div>

      {upcoming ? (
        <div className="py-4 text-center">
          <p className="text-xl font-semibold text-white/80">Upcoming</p>
          <p className={`mt-1 text-sm ${config.accent}`}>Registration not yet open</p>
        </div>
      ) : (
        <>
          {/* Total */}
          <div className="mb-3">
            <p className="text-4xl font-bold tabular-nums">{fmtCount(tier.total.count)}</p>
          </div>

          {/* Breakdown */}
          <div className="mb-3 flex gap-4 text-sm">
            {atCamp !== null && (
              <div>
                <span className={config.accent}>At Camp</span>{' '}
                <span className="font-semibold">{fmtCount(atCamp)}</span>
              </div>
            )}
            {quest !== null && (
              <div>
                <span className={config.accent}>Quest</span>{' '}
                <span className="font-semibold">{fmtCount(quest)}</span>
              </div>
            )}
            {teen !== null && teen > 0 && (
              <div>
                <span className={config.accent}>Teens</span>{' '}
                <span className="font-semibold">{fmtCount(teen)}</span>
              </div>
            )}
          </div>

          {/* Delta vs prior year */}
          {delta.text && priorYear && (
            <p className={`text-sm font-medium ${delta.color}`}>
              {delta.text} vs {priorYear.year}
            </p>
          )}

          {/* Prior year totals */}
          {priorSummaries.length > 0 && (
            <p className={`mt-1 text-xs ${config.accent}`}>{priorSummaries.join(' \u00B7 ')}</p>
          )}
        </>
      )}
    </div>
  )
}

/** Column header labels for the comparison table */
const TIER_LABELS: Array<{ tier: string; label: string }> = [
  { tier: 'priority', label: 'Priority' },
  { tier: 'early', label: 'Early' },
  { tier: 'open', label: 'Open' },
]

interface ComparisonTableProps {
  data: Day1Response
  currentYear: number
}

function ComparisonTable({ data, currentYear }: ComparisonTableProps) {
  // The Teens row only appears when any tier (current or prior year) has teen
  // counts, so the default At Camp / Quest views stay uncluttered.
  const rowCategories = useMemo(() => {
    const allTiers: Day1TierData[] = [...data.tiers, ...data.prior_years.flatMap((py) => py.tiers)]
    const hasTeens = allTiers.some((t) => (getCategoryCount(t, 'teen') ?? 0) > 0)
    return [
      { key: 'at_camp', label: 'At Camp' },
      { key: 'quest', label: 'Quest' },
      ...(hasTeens ? [{ key: 'teen', label: 'Teens' }] : []),
      { key: 'total', label: 'Total' },
    ]
  }, [data])

  // Build ordered year list: current year first, then prior years
  const years = useMemo(() => {
    const result = [currentYear]
    for (const py of data.prior_years) {
      result.push(py.year)
    }
    return result
  }, [currentYear, data.prior_years])

  // Build a lookup: { [tier]: { [year]: Day1TierData } }
  const tierByYear = useMemo(() => {
    const lookup: Record<string, Record<number, Day1TierData>> = {}
    for (const tl of TIER_LABELS) {
      const tierMap: Record<number, Day1TierData> = {}
      // Current year
      const currentTier = findTier(data.tiers, tl.tier)
      if (currentTier) tierMap[currentYear] = currentTier
      // Prior years
      for (const py of data.prior_years) {
        const pyTier = findTier(py.tiers, tl.tier)
        if (pyTier) tierMap[py.year] = pyTier
      }
      lookup[tl.tier] = tierMap
    }
    return lookup
  }, [data, currentYear])

  /** Get cell value for a row/tier/year combination */
  function getCellValue(
    rowKey: string,
    tierKey: string,
    year: number
  ): { display: string; isCurrentYear: boolean } {
    const tier = tierByYear[tierKey]?.[year]
    const isCurrentYear = year === currentYear

    if (!tier) return { display: 'n/a', isCurrentYear }

    // Check if future tier (only for current year)
    if (isCurrentYear && isFutureTier(tier)) {
      return { display: 'Upcoming', isCurrentYear }
    }

    if (rowKey === 'total') {
      return { display: fmtCount(tier.total.count), isCurrentYear }
    }

    const count = getCategoryCount(tier, rowKey)
    return { display: fmtCount(count), isCurrentYear }
  }

  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse">
        <thead>
          {/* Tier group headers */}
          <tr className="bg-muted/50">
            <th className="border-border border-b px-3 py-2 text-left text-xs font-semibold" />
            {TIER_LABELS.map((tl) => (
              <th
                key={tl.tier}
                colSpan={years.length}
                className="border-border border-b border-l px-3 py-2 text-center text-xs font-semibold"
              >
                {tl.label}
              </th>
            ))}
          </tr>
          {/* Year sub-headers */}
          <tr className="bg-muted/30">
            <th className="border-border border-b px-3 py-2 text-left text-xs font-medium" />
            {TIER_LABELS.map((tl) =>
              years.map((year, yi) => (
                <th
                  key={`${tl.tier}-${year}`}
                  className={`border-border border-b px-3 py-2 text-right text-xs ${
                    year === currentYear ? 'font-bold' : 'text-muted-foreground font-normal'
                  } ${yi === 0 ? 'border-l' : ''}`}
                >
                  {year}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rowCategories.map((row) => (
            <tr
              key={row.key}
              className={
                row.key === 'total'
                  ? 'border-border bg-muted/20 border-t-2 font-semibold'
                  : 'border-border border-b'
              }
            >
              <td className="px-3 py-2 text-sm">{row.label}</td>
              {TIER_LABELS.map((tl) =>
                years.map((year, yi) => {
                  const { display, isCurrentYear } = getCellValue(row.key, tl.tier, year)
                  return (
                    <td
                      key={`${tl.tier}-${year}-${row.key}`}
                      className={`px-3 py-2 text-right text-sm tabular-nums ${
                        isCurrentYear ? 'font-bold' : 'text-muted-foreground'
                      } ${yi === 0 ? 'border-border border-l' : ''}`}
                    >
                      {display}
                    </td>
                  )
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Day1Page() {
  const { currentYear } = useCurrentYear()
  const { sessionTypesParam } = useMetricsSession()
  const { data, isLoading, error } = useDay1(currentYear, sessionTypesParam)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Day 1 Registration</h2>
        <p className="text-muted-foreground text-sm">
          First 24 hours of enrollment at each registration tier opening
        </p>
      </div>

      <MetricsQueryGuard
        isLoading={isLoading}
        error={error}
        data={data}
        label="Day 1 registration"
        emptyMessage="No Day 1 registration data available"
      >
        {(day1Data) => (
          <div className="space-y-6">
            {/* Hero cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-tour="reg-day1-summary">
              {day1Data.tiers.map((tier) => (
                <HeroCard key={tier.tier} tier={tier} priorYears={day1Data.prior_years} />
              ))}
            </div>

            {/* Comparison table */}
            {day1Data.tiers.length > 0 && (
              <div>
                <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase">
                  Year-over-Year Comparison
                </h3>
                <ComparisonTable data={day1Data} currentYear={currentYear} />
              </div>
            )}
          </div>
        )}
      </MetricsQueryGuard>
    </div>
  )
}
