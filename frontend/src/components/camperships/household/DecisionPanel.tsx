import { Fragment, type ReactNode } from 'react'

import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import type { RoundLine } from './householdModel'
import {
  HH_AMBER_NOTE,
  HH_LOCK,
  HH_NOTE,
  HH_PANEL_ACTIONABLE,
  HH_PANEL_TD,
  HH_ROUND_PILL,
  HH_TICK,
  HH_TICK_BOX,
  HH_TICK_BOX_ON,
} from './householdStyles'

/** What a line's amount is (plan review number-meaning fix 3). A pending amount names itself. */
const BASIS_WORDS = {
  posted: 'posted',
  decided: 'decided',
  pending: null,
} as const satisfies Record<RoundLine['basis'], string | null>

/** A read-only tick (D6): the mock's 14px forest box with a white ✓, the date muted beside the label. */
function Tick({
  on,
  label,
  round,
  when,
}: {
  on: boolean
  label: string
  round: number
  when?: string | null | undefined
}) {
  return (
    <span data-testid={`tick-${label}-${String(round)}`} className={HH_TICK}>
      <span className={`${HH_TICK_BOX} ${on ? HH_TICK_BOX_ON : ''}`}>{on ? '✓' : ''}</span>
      {label}
      {on && when ? (
        <span className="text-muted-foreground">{` ${formatShortDate(when)}`}</span>
      ) : null}
    </span>
  )
}

const TH =
  'text-muted-foreground border-border border-b px-2 py-1 text-left text-xs font-semibold whitespace-nowrap'

/**
 * The decision panel (§6.3 item 4; D50, D51, D52; decision-panel.html, per-round lines): each round's
 * amount, state, lock and checklist (Posted, Accepted), then the total on the decided basis. Without
 * `checklist` / `nextAction` it only shows; PR 8 hands them in for `casework`.
 */
export function DecisionPanel({
  lines,
  unreached = [],
  total,
  checklist,
  nextAction,
}: {
  lines: readonly RoundLine[]
  /** The rounds not reached yet, drawn muted so every live card has three rows (O2). */
  unreached?: readonly number[]
  total: number | null
  checklist?: ((line: RoundLine) => ReactNode) | undefined
  nextAction?: ((line: RoundLine) => ReactNode) | undefined
}) {
  return (
    <table aria-label="Decision panel" className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={TH}>Round</th>
          <th className={`${TH} text-right`}>Amount</th>
          <th className={TH}>State</th>
          <th className={TH}>Checklist</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <Fragment key={line.round}>
            <tr
              // D10: the round waiting on its offer is the one to act on.
              // A C1 round is waiting on tonight's tick, not on an offer: nothing to act on.
              className={
                line.status === 'needs_offer' && !line.cmPending ? HH_PANEL_ACTIONABLE : undefined
              }
            >
              <td className={`${HH_PANEL_TD} font-bold`}>Round {line.round}</td>
              <td className={`${HH_PANEL_TD} text-right tabular-nums`}>
                {line.basis === 'pending' ? (
                  // The grid's way: amber, and outside the Total (§5.3).
                  <span className={HH_AMBER_NOTE}>{`pending ${formatMoney(line.pending)}`}</span>
                ) : (
                  <>
                    <Money value={line.amount} />
                    {line.amount !== null && (
                      <span className="text-muted-foreground block text-[11px] leading-[1.2]">
                        {line.clawedBack ? 'reversed' : BASIS_WORDS[line.basis]}
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className={HH_PANEL_TD}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className={HH_ROUND_PILL[line.stateTone]}>{line.words}</span>
                  {line.ask !== null && (
                    <span className={HH_NOTE}>
                      {[
                        `ask ${formatMoney(line.ask)}`,
                        line.askedOn ? formatShortDate(line.askedOn) : null,
                      ]
                        .filter((part): part is string => part !== null)
                        .join(' · ')}
                    </span>
                  )}
                  {line.lock !== null && <span className={HH_LOCK}>{line.lock}</span>}
                </div>
              </td>
              <td className={HH_PANEL_TD}>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  {checklist ? (
                    checklist(line)
                  ) : (
                    <>
                      <Tick
                        on={line.posted}
                        label="Posted"
                        round={line.round}
                        when={line.postedOn}
                      />
                      <Tick on={line.accepted} label="Accepted" round={line.round} />
                    </>
                  )}
                </div>
              </td>
              <td className={HH_PANEL_TD}>{nextAction?.(line)}</td>
            </tr>
            {line.cmPendingMessage !== null && (
              // The server's overnight-sync sentence, as the grid's detail line shows it.
              <tr>
                <td colSpan={5} className={`${HH_NOTE} px-2 pb-1.5`}>
                  {line.cmPendingMessage}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {unreached.map((round) => (
          // O2 (ruled 10-04 late): a round not reached yet still has its row, muted.
          <tr key={`unreached-${String(round)}`}>
            <td className={`${HH_PANEL_TD} ${HH_NOTE}`}>Round {round}</td>
            <td className={`${HH_PANEL_TD} ${HH_NOTE} text-right`}>—</td>
            <td colSpan={3} className={HH_PANEL_TD} />
          </tr>
        ))}
        <tr>
          <td className="px-2 py-1.5 font-bold">Total</td>
          <td className="px-2 py-1.5 text-right font-bold tabular-nums">
            <Money value={total} />
          </td>
          <td colSpan={3} className={`${HH_NOTE} px-2 py-1.5`}>
            {lines.some((line) => line.basis === 'pending')
              ? 'Total of the posted and decided amounts; a pending amount waits on finance'
              : 'Total of the posted and decided amounts'}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
