import { Landmark } from 'lucide-react'
import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { isMoneyTab, MONEY_TAB_PURPOSE } from '../../components/camperships/money/moneyTabs'
import { ToPlaceTab } from '../../components/camperships/money/ToPlaceTab'
import { REQUEST_VIEWS } from '../../components/camperships/requests/views'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { aidSection, resolveAidTab } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import PermissionDeniedPage from '../PermissionDeniedPage'

const MONEY = aidSection('money')
const LINK = 'text-primary font-medium hover:underline'

/** The Requests views the ledger also feeds, worked where the request is (§8.1's table). */
const ELSEWHERE = REQUEST_VIEWS.filter((v) => v.key === 'to_reverse' || v.key === 'not_reconciled')

/** One tab not built yet in this part of slice 3: says so, and where its screen comes from. */
function NotYet({ what }: { what: string }) {
  return (
    <div className="card-lodge text-muted-foreground p-6 text-sm">
      {`Money › ${what} is built in a later part of slice 3.`}
    </div>
  )
}

/**
 * Money (spec §8.1; D58, D62; money-v2.html): Ledger · To place · Sources, each a URL-held tab (§3.6).
 * What CampMinder posted that doesn't hang on a request; what does lives with the request, so the
 * page links there. Only the Ledger's posted totals can show a past date (PR 3); the other tabs
 * show today and say so when the link carries a date.
 */
export default function AidMoneyPage() {
  const { tab } = useParams()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const resolved = resolveAidTab(MONEY, tab, { hasPermission })
  if (resolved.kind === 'denied') return <PermissionDeniedPage />
  if (resolved.kind === 'first') {
    // A bare or unknown tab opens To place, the tab with work in it (Decision 2). Every Money tab
    // needs only `view`, which the route already requires.
    return <Navigate to={aidHref(`${MONEY.path}/to-place`, view)} replace />
  }
  const slug = resolved.tab?.slug ?? 'to-place'

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={Landmark}
        title={MONEY.label}
        subtitle={`Season ${String(year)} · what CampMinder posted that no request explains`}
        asOf={asOf}
      />
      <AidTabNav section={MONEY} tabs={resolved.tabs} view={view} />
      {isMoneyTab(slug) && <p className="text-sm">{MONEY_TAB_PURPOSE[slug]}</p>}
      <p className="text-muted-foreground text-xs">
        Also raised by the ledger, worked where the request is:{' '}
        {ELSEWHERE.map((v, i) => (
          <span key={v.key}>
            {i > 0 && ' · '}
            <Link className={LINK} to={aidHref('/aid/requests', view, { view: v.slug })}>
              {`Requests › ${v.label}`}
            </Link>
          </span>
        ))}
        {' · '}
        <Link className={LINK} to={aidHref('/aid/grants/needs-attention', view)}>
          Grants › Needs attention
        </Link>
      </p>
      {slug !== 'ledger' && asOf.kind === 'past' && (
        <p className="text-muted-foreground text-sm">
          {`This tab shows today. Money › Ledger can show ${formatLongDate(asOf.date)}.`}
        </p>
      )}
      {slug === 'to-place' && <ToPlaceTab view={view} />}
      {slug === 'ledger' && <NotYet what="Ledger" />}
      {slug === 'sources' && <NotYet what="Sources" />}
    </div>
  )
}
