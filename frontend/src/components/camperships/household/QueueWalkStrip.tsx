import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import type { WalkStop } from './queueWalk'
import type { QueueWalk } from './useQueueWalk'

function Neighbour({
  stop,
  side,
  hrefOf,
  onLeave,
}: {
  stop: WalkStop | null
  side: 'previous' | 'next'
  hrefOf: (stop: WalkStop) => string
  onLeave: (href: string) => (event: MouseEvent<HTMLAnchorElement>) => void
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
    <Link to={hrefOf(stop)} onClick={onLeave(hrefOf(stop))} className="hover:underline">
      {side === 'previous' ? `‹ ${words}` : `${words} ›`}
    </Link>
  )
}

/**
 * The queue-walk strip (§3.5; D14; decision-panel.html): "‹ Garcia · placeholder income · ← Back to
 * Holds · 3 of 7 families · Sam · tier change ›". `[` and `]` step (useQueueWalk). Its Back is the
 * page's only Back link, a plain link: after stepping, history-back would land on the last family.
 */
export function QueueWalkStrip({
  walk,
  beforeLeave,
}: {
  walk: QueueWalk
  /** A page-owned exit (owner F2 4): a plain click waits for it; a modified click is the browser's. */
  beforeLeave?: ((go: () => void) => void) | undefined
}) {
  const { position, view } = walk
  const navigate = useNavigate()
  const onLeave = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!beforeLeave) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    beforeLeave(() => void navigate(href))
  }
  const back = (
    <Link
      to={walk.backHref}
      onClick={onLeave(walk.backHref)}
      className="text-primary font-medium hover:underline"
    >
      {`← Back to ${view.label}`}
    </Link>
  )
  // No place in the view (the read is loading or failed, or the family has left it): Back alone,
  // and `[`/`]` do nothing (I2).
  if (position === null) {
    const kept = walk.remembered
    return (
      <div className="bg-muted flex flex-wrap items-center gap-3 rounded-lg px-3 py-1.5 text-sm">
        {kept && (
          <Neighbour stop={kept.previous} side="previous" hrefOf={walk.hrefOf} onLeave={onLeave} />
        )}
        {back}
        {walk.absent && <span className="text-muted-foreground">{`not in ${view.label} now`}</span>}
        {kept && <Neighbour stop={kept.next} side="next" hrefOf={walk.hrefOf} onLeave={onLeave} />}
      </div>
    )
  }
  return (
    <div className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm">
      <Neighbour stop={position.previous} side="previous" hrefOf={walk.hrefOf} onLeave={onLeave} />
      <span className="text-muted-foreground">
        {back}
        {` · ${String(position.index + 1)} of ${String(position.total)} families`}
      </span>
      <Neighbour stop={position.next} side="next" hrefOf={walk.hrefOf} onLeave={onLeave} />
    </div>
  )
}
