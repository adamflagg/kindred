import type { ReactNode } from 'react'

import type { ApiAidGridRow } from '../../../types/api-types'
import { TICK_BUTTON } from '../kit/kitStyles'
import { AttentionChip } from '../kit/NeedsAttentionCell'
import { attentionFor, OPEN_REQUEST, type NextStep } from './attention'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
import { acceptedTarget, type TickAction } from './ticks'
import { cmDetail, type ColumnContext } from './views'

const LINK = 'text-primary font-medium hover:underline'
const MUTED = 'text-muted-foreground'

/** Where on the household page a step is done: its income section, or the request's own card. */
const hashOf = (step: Extract<NextStep, { kind: 'link' }>, row: ApiAidGridRow) =>
  step.at === 'income' ? 'income' : `request-${row.request_id}`

function stepOf(
  next: NextStep | null,
  row: ApiAidGridRow,
  links: HouseholdLinks,
  onTick: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
): ReactNode {
  if (next === null) return null
  if (next.kind === 'link') {
    return (
      <HouseholdLink row={row} links={links} className={LINK} hash={hashOf(next, row)}>
        {next.label} ›
      </HouseholdLink>
    )
  }
  if (next.kind === 'text') return <span className={MUTED}>{next.text}</span>
  // The row's own Accepted tick, the same one its Tick column does (no new write path); nothing
  // when the viewer can't tick or the server would refuse it (cancelled in Kindred, review M3).
  if (onTick === undefined || acceptedTarget(row) === null) return null
  return (
    <button
      type="button"
      className={TICK_BUTTON}
      onClick={(event) => {
        event.stopPropagation()
        onTick(row, 'accepted')
      }}
    >
      {next.label}
    </button>
  )
}

/**
 * The opened row's detail line (batch 4, owner LOCKED grid-layout-options.html#or=i, round 6): the
 * chip and the full needs-attention text (attention.ts's, the server's own message for a check or
 * hold), Requested by (T3: the name only, "—" when the server can't name one), the household
 * link, CM ✓ in full, and the next step on the right: a link to where it is done today, plain
 * words, or (Full GO) a button for the row's own Accepted tick, drawn only for someone who can tick
 * and a row the tick takes.
 */
export function RequestDetailLine({
  row,
  ctx,
  links,
  showConfirmation,
  onTick,
}: {
  row: ApiAidGridRow
  ctx: ColumnContext
  links: HouseholdLinks
  /** From the first ticked season, as the CM ✓ column. */
  showConfirmation: boolean
  /** The grid's own row tick (casework on a live read); without it a tick step draws nothing. */
  onTick?: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
}) {
  const found = attentionFor(row, ctx.view, ctx.today, ctx.cancelledOnShown)
  const next = found === null ? OPEN_REQUEST : found.next
  const confirmation = showConfirmation ? cmDetail(row) : null
  const step = stepOf(next, row, links, onTick)
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div>
        {found === null ? (
          <span className={MUTED}>Nothing needs attention on this request.</span>
        ) : (
          <>
            <AttentionChip item={found.item} />
            {found.item.fact !== '' && <span className="ml-1.5">{found.item.fact}</span>}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span className={MUTED}>Requested by</span>
        <span className="font-medium">{row.requested_by ?? '—'}</span>
        <span className={MUTED}>·</span>
        <HouseholdLink row={row} links={links} className={LINK}>
          Household {row.household_cm_id} ›
        </HouseholdLink>
        {confirmation !== null && (
          <>
            <span className={MUTED}>·</span>
            <span className={MUTED}>CM ✓</span>
            <span>{confirmation}</span>
          </>
        )}
        {step !== null && <span className="ml-auto pl-3">{step}</span>}
      </div>
    </div>
  )
}
