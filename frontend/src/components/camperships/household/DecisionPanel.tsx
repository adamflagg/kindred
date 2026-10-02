import type { ReactNode } from 'react'

import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import type { RoundLine } from './householdModel'

/** What a line's amount is (plan review number-meaning fix 3). A pending amount names itself. */
const BASIS_WORDS = {
  posted: 'posted',
  decided: 'decided',
  pending: null,
} as const satisfies Record<RoundLine['basis'], string | null>

/**
 * A locked round's flag. Rules that would lower it never read as a change to what the family has:
 * the posted amount stands (owner ruling 2026-10-01 S1 Q1; D43).
 */
function wouldChangeWords(by: number): string {
  return by < 0
    ? `rules now ${formatMoney(-by)} lower · posted stands`
    : `would change by ${formatMoney(by)}`
}

function Tick({
  on,
  label,
  when,
}: {
  on: boolean
  label: string
  when?: string | null | undefined
}) {
  const date = on && when ? ` ${formatShortDate(when)}` : ''
  return (
    <span
      className={
        on ? 'text-xs whitespace-nowrap' : 'text-muted-foreground text-xs whitespace-nowrap'
      }
    >
      {`${on ? '☑' : '☐'} ${label}${date}`}
    </span>
  )
}

const TH = 'py-1 text-left font-semibold'

/**
 * The decision panel (§6.3 item 4; D50, D51, D52; decision-panel.html, per-round lines): each round's
 * award, state, lock and checklist (Posted, Accepted), then the total on the decided basis. Without
 * `checklist` / `nextAction` it only shows; PR 8 hands them in for `casework`.
 */
export function DecisionPanel({
  lines,
  total,
  checklist,
  nextAction,
}: {
  lines: readonly RoundLine[]
  total: number | null
  checklist?: ((line: RoundLine) => ReactNode) | undefined
  nextAction?: ((line: RoundLine) => ReactNode) | undefined
}) {
  return (
    <table aria-label="Decision panel" className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-xs">
          <th className={TH}>Round</th>
          <th className="py-1 text-right font-semibold">Amount</th>
          <th className={`${TH} pl-3`}>State</th>
          <th className={TH}>Checklist</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.round} className="border-border border-t align-top">
            <td className="py-1 font-medium">Round {line.round}</td>
            <td className="py-1 text-right">
              {line.basis === 'pending' ? (
                // The grid's way: amber, and outside the Total (§5.3).
                <span
                  className={`${AMBER_NOTE} whitespace-nowrap`}
                >{`pending ${formatMoney(line.pending)}`}</span>
              ) : (
                <>
                  <Money value={line.amount} />
                  {line.amount !== null && (
                    <span className="text-muted-foreground block text-xs">
                      {BASIS_WORDS[line.basis]}
                    </span>
                  )}
                </>
              )}
            </td>
            <td className="py-1 pl-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone={line.tone}>{line.words}</StatusPill>
                {line.ask !== null && (
                  <span className="text-muted-foreground text-xs">
                    {[
                      `ask ${formatMoney(line.ask)}`,
                      line.askedOn ? formatShortDate(line.askedOn) : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                  </span>
                )}
                {line.lock !== null && (
                  <span className="text-muted-foreground text-xs">{line.lock}</span>
                )}
                {line.wouldChangeBy !== null && (
                  <StatusPill tone="amber">{wouldChangeWords(line.wouldChangeBy)}</StatusPill>
                )}
              </div>
            </td>
            <td className="py-1">
              <div className="flex flex-wrap items-center gap-2">
                {checklist ? (
                  checklist(line)
                ) : (
                  <>
                    <Tick on={line.posted} label="Posted" when={line.postedOn} />
                    <Tick on={line.accepted} label="Accepted" />
                  </>
                )}
              </div>
            </td>
            <td className="py-1">{nextAction?.(line)}</td>
          </tr>
        ))}
        <tr className="border-border border-t">
          <td className="py-1 font-semibold">Total</td>
          <td className="py-1 text-right font-semibold">
            <Money value={total} />
          </td>
          <td colSpan={3} className="text-muted-foreground py-1 pl-3 text-xs">
            {lines.some((line) => line.basis === 'pending')
              ? 'Total of the posted and decided amounts; a pending amount waits on finance'
              : 'Total of the posted and decided amounts'}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
