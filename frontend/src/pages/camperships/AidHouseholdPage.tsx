import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { useParams } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import { AMBER_NOTE } from '../../components/admin/lodging/lodgingStyles'
import { type AidAsOf, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { HoldBanners } from '../../components/camperships/household/HoldBanners'
import { HouseholdCards } from '../../components/camperships/household/HouseholdCards'
import { bandSubtitle, bandTitle } from '../../components/camperships/household/householdModel'
import { HouseholdTotals } from '../../components/camperships/household/HouseholdTotals'
import {
  GrantsPostingsSection,
  HistorySection,
  IncomeSection,
  LinksSection,
} from '../../components/camperships/household/HouseholdSections'
import { QueueWalkStrip } from '../../components/camperships/household/QueueWalkStrip'
import { RequestCard } from '../../components/camperships/household/RequestCard'
import { useQueueWalk } from '../../components/camperships/household/useQueueWalk'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useAidDefinitions } from '../../hooks/camperships/useAidDefinitions'
import { useAidHouseholdPage } from '../../hooks/camperships/useAidHouseholdPage'
import { useYear } from '../../hooks/useCurrentYear'
import { hasStatus } from '../../services/camperships/aidApi'
import type { ApiAidHouseholdPage } from '../../types/api-types'

/** The household page reads live only (#2924 Known limits; Decision 36). */
const LIVE: AidAsOf = { kind: 'live' }

function HouseholdBody({ page, view }: { page: ApiAidHouseholdPage; view: AidView }) {
  return (
    <>
      <HouseholdCards page={page} />
      <HoldBanners page={page} />
      {page.requests.map((request) => (
        <RequestCard key={request.row.request_id} request={request} page={page} view={view} />
      ))}
      <IncomeSection page={page} />
      <GrantsPostingsSection page={page} />
      <LinksSection page={page} />
      <HistorySection page={page} />
    </>
  )
}

/**
 * `/aid/households/:householdCmId` (§6.3; D8, D26, D32, D77; round7.html, decision-panel.html,
 * household-totals.html B2): the family's whole aid story on one page, scoped to every household with
 * a payer share in its requests, both ways (D26).
 */
export default function AidHouseholdPage() {
  const { householdCmId } = useParams()
  const id = Number(householdCmId)
  const valid = Number.isInteger(id) && id > 0
  const year = useYear()
  const asOf = useAidAsOf()
  const page = useAidHouseholdPage(valid ? id : 0)
  const definitions = useAidDefinitions('household')
  const view = useMemo((): AidView => ({ year, asOf: LIVE }), [year])
  // The links carry the as-of the grid's link did, so Back returns to the same view.
  const linkView = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const walk = useQueueWalk(valid ? id : 0, linkView)
  const data = page.data
  const missing = !valid || hasStatus(page.error, 404)

  return (
    <div className="space-y-3 sm:space-y-4">
      {walk && <QueueWalkStrip walk={walk} />}
      <AidPageBand
        icon={Users}
        title={data ? bandTitle(data) : `Household ${householdCmId ?? ''}`}
        subtitle={data ? bandSubtitle(data) : undefined}
        asOf={LIVE}
        stats={
          data ? (
            <HouseholdTotals totals={data.totals} numberOf={definitions.numberOf} />
          ) : undefined
        }
      />
      {asOf.kind === 'past' && (
        <p className={AMBER_NOTE}>
          {`The household page shows today's figures only. Requests can show ${formatLongDate(asOf.date)}.`}
        </p>
      )}
      {missing ? (
        <div className="card-lodge text-muted-foreground p-6 text-sm">
          {`No aid activity for household ${householdCmId ?? ''} in ${String(year)}.`}
        </div>
      ) : (
        <QueryGuard
          isLoading={page.isLoading}
          // Decision 33: a failed background refetch keeps what loaded.
          error={data ? null : page.error}
          data={data}
          label="household"
        >
          {(loaded) => <HouseholdBody page={loaded} view={view} />}
        </QueryGuard>
      )}
      <AidDefinitionNotes surface="household" />
    </div>
  )
}
