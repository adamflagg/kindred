import { Link } from 'react-router'

import type { WalkStop } from './queueWalk'
import type { QueueWalk } from './useQueueWalk'

function Neighbour({
  stop,
  side,
  hrefOf,
}: {
  stop: WalkStop | null
  side: 'previous' | 'next'
  hrefOf: (stop: WalkStop) => string
}) {
  if (stop === null) {
    return (
      <span className="text-muted-foreground">
        {side === 'previous' ? 'start of the list' : 'end of the list'}
      </span>
    )
  }
  const words = `${stop.familyName}${stop.reason === '' ? '' : ` · ${stop.reason}`}`
  return (
    <Link to={hrefOf(stop)} className="hover:underline">
      {side === 'previous' ? `‹ ${words}` : `${words} ›`}
    </Link>
  )
}

/**
 * The queue-walk strip (§3.5; D14; decision-panel.html): "‹ Garcia · placeholder income · ← Back to
 * Holds · 3 of 7 families · Sam · tier change ›". `[` and `]` step (useQueueWalk). Its Back is the
 * page's only Back link, a plain link: after stepping, history-back would land on the last family.
 */
export function QueueWalkStrip({ walk }: { walk: QueueWalk }) {
  const { position, view } = walk
  const back = (
    <Link to={walk.backHref} className="text-primary font-medium hover:underline">
      {`← Back to ${view.label}`}
    </Link>
  )
  // No place in the view (the read is loading or failed, or the family has left it): Back alone,
  // and `[`/`]` do nothing (I2).
  if (position === null) {
    return (
      <div className="bg-muted flex flex-wrap items-center gap-3 rounded-lg px-3 py-1.5 text-sm">
        {back}
        {walk.absent && <span className="text-muted-foreground">{`not in ${view.label} now`}</span>}
      </div>
    )
  }
  return (
    <div className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm">
      <Neighbour stop={position.previous} side="previous" hrefOf={walk.hrefOf} />
      <span className="text-muted-foreground">
        {back}
        {` · ${String(position.index + 1)} of ${String(position.total)} families`}
      </span>
      <Neighbour stop={position.next} side="next" hrefOf={walk.hrefOf} />
    </div>
  )
}
