import { Landmark } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'

import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { RegisterTab } from '../../components/camperships/grants/RegisterTab'
import { householdParam } from '../../components/camperships/money/moneyTabs'
import { LedgerTab } from '../../components/camperships/money/LedgerTab'
import { FundersTab } from '../../components/camperships/money/FundersTab'
import { ToPlaceTab } from '../../components/camperships/money/ToPlaceTab'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { toPlaceCount } from '../../components/camperships/money/toPlaceModel'
import { aidSection, resolveAidTab } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useAidGrants } from '../../hooks/camperships/useAidGrants'
import { useAidToPlace } from '../../hooks/camperships/useAidToPlace'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import PermissionDeniedPage from '../PermissionDeniedPage'

const MONEY = aidSection('money')

/**
 * Money (spec §8.1, §8.2; D58, D62; owner 10-08): Ledger · To place · Grants · Funders, each a URL-held
 * tab (§3.6). It opens on the first tab the user may see: the Ledger, or Funders for development.
 * Only the Ledger's posted totals can show a past date; the other tabs show today and say so when
 * the link carries a date. Funders is the sources and the grantors in one table, grouped by who pays.
 */
export default function AidMoneyPage() {
  const { tab } = useParams()
  const [params] = useSearchParams()
  // `?household=<cm_id>`: To place scoped to one family (D26; P-8), from a line's "Only This
  // Family ›" or the grid's and household page's "Place It in Money › To Place ›" (ruling C).
  const householdCmId = householdParam(params.get('household'))
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  // The To place tab's count (M5): camp aid's open_count plus the outside-grant lines that need a
  // camper, both season-wide whatever `?household=` says. The reads are the tab's own cache entries
  // and are enabled for view holders only.
  const campAid = useAidToPlace(null)
  const grants = useAidGrants()
  const placeCount = toPlaceCount(campAid.data?.open_count, grants.data?.needs_camper.length)
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
        // §6: no sentence row that pushes the page down; the pill says which tabs show today.
        asOfTitle={
          asOf.kind === 'past'
            ? `Money › Ledger shows ${formatLongDate(asOf.date)}. To place, Grants and Funders show today.`
            : undefined
        }
      />
      <AidTabNav
        section={MONEY}
        tabs={resolved.tabs}
        view={view}
        counts={{ 'to-place': placeCount ?? undefined }}
      />
      {slug === 'to-place' && <ToPlaceTab view={view} householdCmId={householdCmId} />}
      {slug === 'ledger' && <LedgerTab view={view} />}
      {slug === 'grants' && (
        <>
          <RegisterTab view={view} />
          <AidDefinitionNotes surface="grants" />
        </>
      )}
      {slug === 'funders' && <FundersTab view={view} />}
    </div>
  )
}
