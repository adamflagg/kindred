import { HandCoins } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router'

import {
  GRANTS_LIVE_ONLY,
  GRANTS_TAB_PURPOSE,
  isGrantsTab,
} from '../../components/camperships/grants/grantsTabs'
import { ExpectedTab } from '../../components/camperships/grants/ExpectedTab'
import { NeedsAttentionTab } from '../../components/camperships/grants/NeedsAttentionTab'
import { RegisterTab } from '../../components/camperships/grants/RegisterTab'
import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { CS_SMALL } from '../../components/camperships/kit/csType'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { aidSection, resolveAidTab } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import PermissionDeniedPage from '../PermissionDeniedPage'

const GRANTS = aidSection('grants')

/** A tab built by a later slice 3 PR: one line until then. */
function NotYet({ what }: { what: string }) {
  return (
    <div className="card-lodge text-muted-foreground p-6 text-sm">
      {`Grants › ${what} is built in a later part of slice 3.`}
    </div>
  )
}

/**
 * Grants (spec §8.2; D55–D57, D126, D142, D160; grants-v2.html): Register · Needs attention ·
 * Expected · Grantors, each a URL-held tab (§3.6), its purpose line under the tabs. Outside grants,
 * read from the CampMinder ledger, outside the camp's budget. Live only (P-18): a past date in the
 * link is named and not applied. No band total (review item 10: it would be a second sum).
 */
export default function AidGrantsPage() {
  const { tab } = useParams()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const resolved = resolveAidTab(GRANTS, tab, { hasPermission })
  if (resolved.kind === 'denied') return <PermissionDeniedPage />
  if (resolved.kind === 'first') {
    return <Navigate to={aidHref(`${GRANTS.path}/${resolved.tab.slug}`, view)} replace />
  }
  const slug = resolved.tab?.slug ?? 'register'

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={HandCoins}
        title={GRANTS.label}
        subtitle={`Season ${String(year)} · outside grants, read from the CampMinder ledger · outside the camp's budget: never in Remaining`}
        asOf={asOf}
      />
      <AidTabNav section={GRANTS} tabs={resolved.tabs} view={view} />
      {isGrantsTab(slug) && <p className={CS_SMALL}>{GRANTS_TAB_PURPOSE[slug]}</p>}
      {asOf.kind === 'past' && <p className="text-muted-foreground text-sm">{GRANTS_LIVE_ONLY}</p>}
      {slug === 'register' && <RegisterTab view={view} />}
      {slug === 'needs-attention' && <NeedsAttentionTab view={view} />}
      {slug === 'expected' && <ExpectedTab view={view} />}
      {slug === 'grantors' && <NotYet what="Grantors" />}
      <AidDefinitionNotes surface="grants" />
    </div>
  )
}
