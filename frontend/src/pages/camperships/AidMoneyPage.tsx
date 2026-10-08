import { Landmark } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router'

import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { GRANTS_LIVE_ONLY } from '../../components/camperships/grants/grantsTabs'
import { GrantorsDirectory } from '../../components/camperships/grants/GrantorsDirectory'
import { RegisterTab } from '../../components/camperships/grants/RegisterTab'
import { householdParam, MONEY_TAB_ALIASES } from '../../components/camperships/money/moneyTabs'
import { LedgerTab } from '../../components/camperships/money/LedgerTab'
import { SourcesTab } from '../../components/camperships/money/SourcesTab'
import { ToPlaceTab } from '../../components/camperships/money/ToPlaceTab'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { aidSection, resolveAidTab } from '../../config/aidNav'
import { Permission } from '../../constants/permissions'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import type { ApiAidGrantorDescription } from '../../types/api-types'
import PermissionDeniedPage from '../PermissionDeniedPage'

const MONEY = aidSection('money')

/**
 * Money (spec §8.1, §8.2; D58, D62; owner 10-08): Ledger · To place · Grants · Funders, each a URL-held
 * tab (§3.6). It opens on the first tab the user may see: the Ledger, or Funders for development.
 * Only the Ledger's posted totals can show a past date; the other tabs show today and say so when
 * the link carries a date. Funders is Sources with the Grantors directory under it until M3.
 */
export default function AidMoneyPage() {
  const { tab } = useParams()
  const [params] = useSearchParams()
  // `?household=<cm_id>`: To place scoped to one family (D26; P-8), from a line's "Only This
  // Family ›" or the grid's and household page's "Place It in Money › To Place ›" (ruling C).
  const householdCmId = householdParam(params.get('household'))
  const { search } = useLocation()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  // P-19: a description opens its Funders row, for a `view` holder only; development (grantors,
  // no view) sees the descriptions as plain text.
  const canView = hasPermission(Permission.FINANCIAL_AID_VIEW)
  const sourcesHref = useCallback(
    (d: ApiAidGrantorDescription) => aidHref('/aid/money/funders', view, { row: d.source_id }),
    [view]
  )
  // The old Sources tab is Funders now; links keep their `?row=`.
  const alias = tab === undefined ? undefined : MONEY_TAB_ALIASES[tab]
  if (alias !== undefined) return <Navigate to={`${MONEY.path}/${alias}${search}`} replace />
  const resolved = resolveAidTab(MONEY, tab, { hasPermission })
  if (resolved.kind === 'denied') return <PermissionDeniedPage />
  if (resolved.kind === 'first') {
    // A bare or unknown tab opens the first one this user may see: the Ledger for view holders,
    // Funders for development (owner 10-08; Decision 2's "To place first" is revisited).
    return <Navigate to={aidHref(`${MONEY.path}/${resolved.tab.slug}`, view)} replace />
  }
  const slug = resolved.tab?.slug ?? 'ledger'

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={Landmark}
        title={MONEY.label}
        subtitle={`Season ${String(year)} · what CampMinder posted`}
        asOf={asOf}
      />
      <AidTabNav section={MONEY} tabs={resolved.tabs} view={view} />
      {slug !== 'ledger' && asOf.kind === 'past' && (
        <p className="text-muted-foreground text-sm">
          {slug === 'grants'
            ? GRANTS_LIVE_ONLY
            : `This tab shows today. Money › Ledger can show ${formatLongDate(asOf.date)}.`}
        </p>
      )}
      {slug === 'to-place' && <ToPlaceTab view={view} householdCmId={householdCmId} />}
      {slug === 'ledger' && <LedgerTab view={view} />}
      {slug === 'grants' && (
        <>
          <RegisterTab view={view} />
          <AidDefinitionNotes surface="grants" />
        </>
      )}
      {slug === 'funders' && (
        <>
          <SourcesTab view={view} />
          <GrantorsDirectory view={view} descriptionHref={canView ? sourcesHref : undefined} />
        </>
      )}
    </div>
  )
}
