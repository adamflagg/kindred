import { useState, type ReactNode } from 'react'

import { AidWriteError } from '../../../services/camperships/aidApi'
import type { ApiAidGridRow } from '../../../types/api-types'
import { TICK_BUTTON } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { AttentionChip } from '../kit/NeedsAttentionCell'
import { attentionFor, OPEN_REQUEST, type NextStep } from './attention'
import { appealTarget } from './gridEditor'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
import { roundOf } from './stage'
import { acceptedTarget, nameOf, type TickAction } from './ticks'
import { cmDetail, type ColumnContext } from './views'

const LINK = 'text-primary font-medium hover:underline'
const MUTED = 'text-muted-foreground'

/** Where on the household page a step is done: its income section, or the request's own card. */
const hashOf = (step: Extract<NextStep, { kind: 'link' }>, row: ApiAidGridRow) =>
  step.at === 'income' ? 'income' : `request-${row.request_id}`

/** The hand Posted write (#2996): resolves once written, rejects with the server's refusal. */
export type MarkPosted = (row: ApiAidGridRow, round: number, amount: number) => Promise<unknown>

/**
 * "Mark Posted · locks $X" (#2996 hand tick, the existing Posted write): the label is the
 * confirmation, as the household page's. A refusal says the server's sentence beside it, naming
 * the row, not the request id the server prefixes it with. A withheld round's decided_now is what
 * the tick WOULD lock, so refreshing and marking it posted again can only be refused again: a 409
 * that names a different amount offers it (#2981).
 */
function MarkPostedStep({
  row,
  round,
  amount,
  label,
  onMarkPosted,
}: {
  row: ApiAidGridRow
  round: number
  amount: number
  label: string
  onMarkPosted: MarkPosted
}) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [offer, setOffer] = useState<number | null>(null)
  // A refusal belongs to the round and amount it was made on: a change under it clears it.
  const stepKey = `${String(round)}:${String(amount)}`
  const [seenKey, setSeenKey] = useState(stepKey)
  if (seenKey !== stepKey) {
    setSeenKey(stepKey)
    setRefusal(null)
    setOffer(null)
  }
  const mark = (at: number) => {
    setBusy(true)
    setRefusal(null)
    setOffer(null)
    onMarkPosted(row, round, at).then(
      () => setBusy(false),
      (error: unknown) => {
        setBusy(false)
        const text = error instanceof Error ? error.message : String(error)
        setRefusal(text.replaceAll(row.request_id, nameOf(row)))
        if (error instanceof AidWriteError && error.status === 409) {
          const moved = error.rows.find((r) => r.request_id === row.request_id && r.round === round)
          if (moved?.decided_now != null && moved.decided_now !== at) setOffer(moved.decided_now)
        }
      }
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {refusal !== null && (
        <span className="text-amber-700 dark:text-amber-400">{`Couldn't mark it posted: ${refusal}`}</span>
      )}
      <button
        type="button"
        className={TICK_BUTTON}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation()
          mark(amount)
        }}
      >
        {`${label} · locks ${formatMoney(amount)}`}
      </button>
      {offer !== null && (
        <button
          type="button"
          className={TICK_BUTTON}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            mark(offer)
          }}
        >
          {`${label} at ${formatMoney(offer)}`}
        </button>
      )}
    </span>
  )
}

function stepOf(
  next: NextStep | null,
  row: ApiAidGridRow,
  links: HouseholdLinks,
  onTick: ((row: ApiAidGridRow, action: TickAction) => void) | undefined,
  onMarkPosted: MarkPosted | undefined
): ReactNode {
  if (next === null) return null
  if (next.kind === 'markPosted') {
    // Only for someone who can tick, and a round with a decided amount to lock.
    const amount = roundOf(row, next.round)?.decided ?? null
    if (onMarkPosted === undefined || amount === null) return null
    return (
      <MarkPostedStep
        row={row}
        round={next.round}
        amount={amount}
        label={next.label}
        onMarkPosted={onMarkPosted}
      />
    )
  }
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

/** The left panel's width beside an editor (opened-row-options.html arrangement 3: 384px). */
const SIDE_BY_SIDE = 'grid grid-cols-[24rem_minmax(0,1fr)] items-stretch text-sm'
const LEFT_BESIDE_EDITOR =
  'flex min-w-0 flex-col gap-1 border-r border-dashed border-amber-300 pr-4 dark:border-amber-800'
const RIGHT_PANEL = 'min-w-0 pl-4'

/**
 * The opened row's detail line (batch 4, owner LOCKED grid-layout-options.html#or=i, round 6), laid
 * out as opened-row-options.html arrangement 3 "Side by side" (owner fast-follow, 10-03). The left
 * panel: the chip and the full needs-attention text (attention.ts's, the server's own message for a
 * check or hold), then Requested by (T3: the name only, "—" when the server can't name one), the
 * household link (the household is named once, here) and CM ✓ in full. No Person id (owner, (c)).
 * The next step: a link to where it is done, plain words, or (Full GO) a button for the row's own
 * Accepted tick, drawn only for someone who can tick and a row the tick takes.
 *
 * With an `editor` and a row that takes an ask, the editor is the right panel and the step ends its
 * line. Otherwise the left content takes the width with the step top right, and whatever the
 * editor says about the row (why it takes no ask, a refused save) sits under it.
 */
export function RequestDetailLine({
  row,
  ctx,
  links,
  showConfirmation,
  onTick,
  onMarkPosted,
  editor,
}: {
  row: ApiAidGridRow
  ctx: ColumnContext
  links: HouseholdLinks
  /** From the first ticked season, as the CM ✓ column. */
  showConfirmation: boolean
  /** The grid's own row tick (casework on a live read); without it a tick step draws nothing. */
  onTick?: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
  /** The hand Posted tick (#2996; casework on a live read); without it Mark Posted draws nothing. */
  onMarkPosted?: MarkPosted | undefined
  /** The row's editor, handed the step to end its line with (null where it draws no editor). */
  editor?: ((step: ReactNode) => ReactNode) | undefined
}) {
  const found = attentionFor(row, ctx.view, ctx.today, ctx.cancelledOnShown)
  const next = found === null ? OPEN_REQUEST : found.next
  const confirmation = showConfirmation ? cmDetail(row) : null
  const step = stepOf(next, row, links, onTick, onMarkPosted)
  const beside = editor !== undefined && appealTarget(row).kind === 'appeal'
  const left = (
    <div
      data-detail-left=""
      className={beside ? LEFT_BESIDE_EDITOR : 'flex min-w-0 flex-col gap-1'}
    >
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
      </div>
    </div>
  )
  if (beside) {
    return (
      <div className={SIDE_BY_SIDE}>
        {left}
        {/* The editor's own keys (↑/↓ save and move on) stay its own: AidTable stands aside here. */}
        <div data-aid-editor="" className={RIGHT_PANEL}>
          {editor(step)}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start">
        {left}
        {step !== null && <div className="pl-3 text-xs">{step}</div>}
      </div>
      {editor !== undefined && (
        <div data-aid-editor="" className="empty:hidden">
          {editor(null)}
        </div>
      )}
    </div>
  )
}
