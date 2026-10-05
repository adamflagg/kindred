import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { aidHref, type AidView } from '../kit/asOf'
import type { DuplicatePair } from './duplicatePair'
import { HH_LINK } from './householdStyles'

/**
 * Item 11 (owner ruling 10-05): the quick way to the other request of a duplicate pair. On this page
 * it scrolls to that card, as the hold banners' fix links do (`#request-…`); on another household's
 * page it opens that page, found by the request's id in the season's live grid (read only for this).
 */
export function OtherRequestLink({
  pair,
  view,
  beforeLeave,
}: {
  pair: DuplicatePair
  view: AidView
  /** A page-owned exit (owner F2 4): a plain click waits for it, as the queue walk's links do. */
  beforeLeave?: ((go: () => void) => void) | undefined
}) {
  if (pair.other !== null) {
    return (
      <a href={`#request-${pair.otherId}`} className={HH_LINK}>
        Go to the Other Request ↓
      </a>
    )
  }
  return <ElsewhereLink otherId={pair.otherId} view={view} beforeLeave={beforeLeave} />
}

function ElsewhereLink({
  otherId,
  view,
  beforeLeave,
}: {
  otherId: string
  view: AidView
  beforeLeave?: ((go: () => void) => void) | undefined
}) {
  const navigate = useNavigate()
  const grid = useAidGrid({ live: true })
  const household = grid.data?.rows.find((row) => row.request_id === otherId)?.household_cm_id
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
      Go to the Other Request ›
    </Link>
  )
}
