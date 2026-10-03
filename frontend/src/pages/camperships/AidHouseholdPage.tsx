import { Users } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import { ACTION_LINK, AMBER_NOTE } from '../../components/admin/lodging/lodgingStyles'
import { aidHref, type AidAsOf, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { HoldBanners } from '../../components/camperships/household/HoldBanners'
import { HouseholdCards } from '../../components/camperships/household/HouseholdCards'
import { bandSubtitle, bandTitle } from '../../components/camperships/household/householdModel'
import { HouseholdTotals } from '../../components/camperships/household/HouseholdTotals'
import { RequestCard } from '../../components/camperships/household/RequestCard'
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
    </>
  )
}

/** What the grid keeps in its URL besides the view (the lens too); a household link carries them back (M5). */
const GRID_FILTERS = ['lens', 'program', 'pool', 'round', 'tick', 'ids'] as const

/**
 * "← Back to Requests": the grid's view and filters, rebuilt from the link that opened this page.
 * When the grid opened this entry (it marks it `aidFromGrid`) the click goes back through history,
 * so the grid lands on the row it left (§3.5: the grid wrote `?row=` onto its own entry first).
 * Anything else (a new tab, a jump, a queue step) follows the href, whose view carries the as-of.
 */
function BackToRequests({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const fromGrid = (state as { aidFromGrid?: boolean } | null)?.aidFromGrid === true
  const from = params.get('from')
  if (from === null) return null
  // One URL scheme (owner ruling 10-03, T4): `from=all` is All, which has no `view`.
  const extra: Record<string, string> = from === 'all' ? {} : { view: from }
  for (const name of GRID_FILTERS) {
    const value = params.get(name)
    if (value !== null) extra[name] = value
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!fromGrid) return
    event.preventDefault()
    void navigate(-1)
  }
  return (
    <div>
      <Link
        to={aidHref('/aid/requests', view, extra)}
        onClick={onClick}
        className={`text-primary ${ACTION_LINK}`}
      >
        ← Back to Requests
      </Link>
    </div>
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
  const data = page.data
  const missing = !valid || hasStatus(page.error, 404)

  return (
    <div className="space-y-3 sm:space-y-4">
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
      <BackToRequests view={{ year, asOf }} />
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
