import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { aidHref, type AidView } from '../kit/asOf'
import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { useWithdrawnPair, type DuplicatePair } from './duplicatePair'
import { HH_LINK } from './householdStyles'

/**
 * Item 11 (owner ruling 10-05): the quick way to the other request of a duplicate pair when it is on
 * another household's page: the household the server named (#3031), else found by the request's id
 * in the season's live grid (read only for this).
 * Nothing when the twin is on this same page (owner V4): both cards are in view.
 */
export function OtherRequestLink({
  pair,
  view,
  beforeLeave,
  which = 'Other',
}: {
  pair: DuplicatePair
  view: AidView
  /** A page-owned exit (owner F2 4): a plain click waits for it, as the queue walk's links do. */
  beforeLeave?: ((go: () => void) => void) | undefined
  /** The request it names: "the Other Request", or a revived duplicate's "Withdrawn Request" (item 4c). */
  which?: 'Other' | 'Withdrawn'
}) {
  if (pair.other !== null) return null
  return (
    <ElsewhereLink
      otherId={pair.otherId}
      known={pair.waiting?.household_cm_id}
      view={view}
      beforeLeave={beforeLeave}
      which={which}
    />
  )
}

/**
 * Item 4c (owner ruling 10-05): a revived duplicate's hold banner links the withdrawn request it was
 * the duplicate of, the same way a duplicate pair links its other request. Nothing without the hold.
 */
export function WithdrawnRequestLink({
  page,
  request,
  view,
  beforeLeave,
}: {
  page: ApiAidHouseholdPage
  request: ApiAidHouseholdRequest
  view: AidView
  beforeLeave?: ((go: () => void) => void) | undefined
}) {
  const pair = useWithdrawnPair(page, request)
  if (pair === null) return null
  return <OtherRequestLink pair={pair} view={view} beforeLeave={beforeLeave} which="Withdrawn" />
}

function ElsewhereLink({
  otherId,
  known,
  view,
  beforeLeave,
  which,
}: {
  otherId: string
  /** The twin's household when the server already named it (#3031 duplicates_waiting): no grid read. */
  known?: number | undefined
  view: AidView
  beforeLeave?: ((go: () => void) => void) | undefined
  which: 'Other' | 'Withdrawn'
}) {
  const navigate = useNavigate()
  const grid = useAidGrid({ live: true, enabled: known === undefined })
  const household =
    known ?? grid.data?.rows.find((row) => row.request_id === otherId)?.household_cm_id
  // Until the grid names its household, there is nowhere to go.
  if (household === undefined) return null
  const href = aidHref(`/aid/households/${String(household)}`, view)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!beforeLeave) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    beforeLeave(() => void navigate(href))
  }
  return (
    <Link to={href} onClick={onClick} className={HH_LINK}>
      Go to the {which} Request ›
    </Link>
  )
}
