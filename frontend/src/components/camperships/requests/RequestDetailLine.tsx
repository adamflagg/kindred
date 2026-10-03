import type { ApiAidGridRow } from '../../../types/api-types'
import { AttentionChip } from '../kit/NeedsAttentionCell'
import { attentionFor, OPEN_REQUEST, type NextStep } from './attention'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
import { confirmationDetail, type ColumnContext } from './views'

const LINK = 'text-primary font-medium hover:underline'
const MUTED = 'text-muted-foreground'

/** Where on the household page a step is done: its income section, or the request's own card. */
const hashOf = (step: Extract<NextStep, { kind: 'link' }>, row: ApiAidGridRow) =>
  step.at === 'income' ? 'income' : `request-${row.request_id}`

/**
 * The opened row's detail line (batch 4, owner LOCKED grid-layout-options.html#or=i, round 6): the
 * chip and the full needs-attention text (attention.ts's, the server's own message for a check or
 * hold), Requested by (T3: the name only, "—" when the server can't name one), the household
 * link, CM ✓ in full, and the next step on the right. #2943 has no writers, so the step is a link to where it is done today or
 * plain words, never a button; a tick or the editor (#2951, #2948) draws nothing yet.
 */
export function RequestDetailLine({
  row,
  ctx,
  links,
  showConfirmation,
}: {
  row: ApiAidGridRow
  ctx: ColumnContext
  links: HouseholdLinks
  /** From the first ticked season, as the CM ✓ column. */
  showConfirmation: boolean
}) {
  const found = attentionFor(row, ctx.view, ctx.today, ctx.cancelledOnShown)
  const next = found === null ? OPEN_REQUEST : found.next
  const confirmation = showConfirmation && row.confirmation ? row.confirmation : null
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
            <span>{confirmationDetail(confirmation)}</span>
          </>
        )}
        {next !== null && (
          <span className="ml-auto pl-3">
            {next.kind === 'link' ? (
              <HouseholdLink row={row} links={links} className={LINK} hash={hashOf(next, row)}>
                {next.label} ›
              </HouseholdLink>
            ) : (
              <span className={MUTED}>{next.text}</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
