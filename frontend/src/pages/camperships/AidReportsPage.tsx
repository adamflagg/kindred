import { FileBarChart } from 'lucide-react'
import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { DevelopmentReport } from '../../components/camperships/reports/DevelopmentReport'
import { StatisticsTab } from '../../components/camperships/reports/StatisticsTab'
import { YearOverYear } from '../../components/camperships/reports/YearOverYear'
import { ZipCodes } from '../../components/camperships/reports/ZipCodes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { CS_BAND_WARN, CS_LINK } from '../../components/camperships/kit/csType'
import { aidSection, resolveAidTab, visibleTabs } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import PermissionDeniedPage from '../PermissionDeniedPage'

const REPORTS = aidSection('reports')

/** The tabs a past date can't reach: each reads today only (their reads take no as-of). */
const LIVE_ONLY = new Set(['year-over-year', 'development', 'zip-codes'])

/**
 * Reports (spec §9; D63–D70; statistics-v2.html, development-v2.html, zip-codes.html): Statistics ·
 * Year over year · Development · ZIP codes, four flat URL-held tabs (owner Q7). View holders land on
 * Statistics; a summary-only user sees Development and ZIP codes and lands on Development (D65), through
 * `resolveAidTab`.
 */
export default function AidReportsPage() {
  const { tab: tabParam } = useParams()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const tab = tabParam
  const resolved = resolveAidTab(REPORTS, tab, { hasPermission })
  if (resolved.kind === 'denied') {
    // A known Reports tab this user can't open: keep the band and tabs, and point at theirs.
    const known = REPORTS.tabs.find((t) => t.slug === tab)
    if (known === undefined) return <PermissionDeniedPage />
    return (
      <div className="space-y-3 sm:space-y-4">
        <AidPageBand
          icon={FileBarChart}
          title={REPORTS.label}
          subtitle={`Season ${String(year)}`}
          asOf={asOf}
        />
        <AidTabNav section={REPORTS} tabs={visibleTabs(REPORTS, { hasPermission })} view={view} />
        <div
          className={`${CS_BAND_WARN} rounded-lg border border-amber-300 px-2.5 py-[3px] text-[12.5px] dark:border-amber-800`}
        >
          <b>
            {known.slug === 'year-over-year'
              ? "Year over year is finance's report."
              : `${known.label} is for finance and the registrar.`}
          </b>{' '}
          <span className="text-muted-foreground">
            Development&apos;s report is{' '}
            <Link to={aidHref(`${REPORTS.path}/development`, view)} className={CS_LINK}>
              Reports › Development ›
            </Link>
          </span>
        </div>
      </div>
    )
  }
  if (resolved.kind === 'first') {
    return <Navigate to={aidHref(`${REPORTS.path}/${resolved.tab.slug}`, view)} replace />
  }
  const current = resolved.tab
  if (current === undefined) return <PermissionDeniedPage />
  const at = current.slug

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={FileBarChart}
        title={at === 'development' || at === 'zip-codes' ? 'Development report' : REPORTS.label}
        subtitle={
          at === 'zip-codes'
            ? `Where ${String(year)} campers live, by ZIP: counts and dollars, never a family`
            : at === 'development'
              ? 'Aid by season, for grant writing: numbers and quantities, never a family'
              : `Season ${String(year)} · from the dashboard's Posted amounts and the typed history`
        }
        asOf={asOf}
      />
      <AidTabNav section={REPORTS} tabs={resolved.tabs} view={view} />
      {asOf.kind === 'past' && LIVE_ONLY.has(at) && (
        <p className="text-muted-foreground text-sm">This view shows today: it has no past date.</p>
      )}
      {at === 'statistics' && <StatisticsTab view={view} />}
      {at === 'year-over-year' && <YearOverYear view={view} />}
      {at === 'development' && <DevelopmentReport view={view} />}
      {at === 'zip-codes' && <ZipCodes view={view} />}
    </div>
  )
}
