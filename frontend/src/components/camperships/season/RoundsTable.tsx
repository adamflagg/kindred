import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { CS_LINK_CELL, CS_RULE, CS_RULE_GROUP } from '../kit/csType'
import { TABLE_CARD, TFOOT_CELL } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { noteMark } from './BudgetCard'
import type { LedgerFigure, LedgerRow } from './budgetCards'
import type { RoundsFigure } from './roundsNotes'
import {
  RG_TABLE,
  RG_TD,
  RG_TD_GROUP_NUM,
  RG_TD_NUM,
  RG_TH,
  RG_TH_GROUP_MID,
  RG_TH_GROUP_NUM,
  RG_TH_NUM,
} from './rules/gridStyles'

const AMBER_INK = `${POOL_NEGATIVE_INK} font-semibold`
const FOOT_NUM = `${TFOOT_CELL} text-right tabular-nums`
const FOOT_GROUP_NUM = FOOT_NUM.replace(CS_RULE, CS_RULE_GROUP)

function Figure({ figure, foot }: { figure: LedgerFigure | null; foot: boolean }): ReactNode {
  if (figure === null) return null
  const ink = figure.amber === true ? AMBER_INK : ''
  if (figure.href === null || foot) {
    return figure.amber === true ? (
      <span className={AMBER_INK} title={figure.title}>
        {figure.words}
      </span>
    ) : (
      figure.words
    )
  }
  return (
    <Link
      to={figure.href}
      title={figure.title}
      className={figure.amber === true ? `text-sm hover:underline ${ink}` : CS_LINK_CELL}
    >
      {figure.words}
    </Link>
  )
}

/**
 * The ruled ledger (kit grid; mock `wicTable`): Pool · round, Committed, and the five What-is-committed columns
 * (rounds-1, -3). A pool row opens into its rounds (its caret is the toggle); the season, or the one pool, sits in the
 * green band. Never an Allocated or a Remaining here: those are the cards' (§8.1).
 */
export function RoundsTable({
  rows,
  open,
  onToggle,
  numberOf,
}: {
  rows: readonly LedgerRow[]
  open: ReadonlySet<string>
  onToggle: (key: string) => void
  numberOf: (key: string) => number | null
}) {
  const n = (figure: RoundsFigure) => noteMark(numberOf, figure)
  return (
    <div className={TABLE_CARD}>
      <table data-testid="rounds-table" className={`${RG_TABLE} table-fixed`}>
        <colgroup>
          <col style={{ width: 200 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 128 }} />
          <col style={{ width: 136 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} className={RG_TH} />
            <th colSpan={5} className={RG_TH_GROUP_MID}>
              What is committed{n('committed')}
            </th>
          </tr>
          <tr>
            <th className={RG_TH}>Pool · round</th>
            <th className={RG_TH_NUM}>Committed{n('committed')}</th>
            <th className={RG_TH_GROUP_NUM}>Posted{n('posted')}</th>
            <th
              className={RG_TH_NUM}
              title="Posted rounds whose Accepted checkbox is checked, less clawbacks that posted. Shown, never subtracted."
            >
              Accepted
            </th>
            <th className={RG_TH_NUM}>Needs an offer{n('needs_offer')}</th>
            <th
              className={RG_TH_NUM}
              title="Round 3 only. On approval it moves to Needs an offer; on refusal it leaves."
            >
              Pending approval{n('pending_approval')}
            </th>
            <th
              className={RG_TH_NUM}
              title="CampMinder's live camp aid fills each request's posted rounds oldest first. Money beyond the locked total stays in Requests › Not reconciled."
            >
              Not yet confirmed{n('unconfirmed')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const foot = row.kind === 'foot'
            const num = foot ? FOOT_NUM : RG_TD_NUM
            const gnum = foot ? FOOT_GROUP_NUM : RG_TD_GROUP_NUM
            const muted = row.kind === 'nopool' ? ' text-muted-foreground' : ''
            // A round sits 24px in under its pool (mock td.ind). Kept out of the className literal: the Tailwind
            // formatter trims a leading space there, which once glued it onto whitespace-nowrap.
            const indent = row.kind === 'round' ? ' pl-6' : ''
            const isOpen = open.has(row.pool)
            return (
              <tr
                key={row.key}
                data-ledger={row.kind}
                data-pool={row.kind === 'pool' ? row.pool : undefined}
                data-round={row.kind === 'round' ? row.label.replace('Round ', '') : undefined}
              >
                <td
                  title={row.title}
                  className={`${foot ? `${TFOOT_CELL} text-left` : RG_TD}${muted}${indent}`}
                >
                  {row.kind === 'pool' ? (
                    <button
                      type="button"
                      className="cursor-pointer"
                      aria-expanded={isOpen}
                      onClick={() => onToggle(row.pool)}
                    >
                      <span className="text-muted-foreground inline-block w-3 text-left text-[10px] leading-5">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <b>{row.label}</b>
                    </button>
                  ) : (
                    row.label
                  )}
                </td>
                <td className={`${num}${muted}`}>
                  {row.kind === 'pool' ? (
                    <b>{formatMoney(row.committed)}</b>
                  ) : (
                    formatMoney(row.committed)
                  )}
                </td>
                <td className={`${gnum}${muted}`}>
                  <Figure figure={row.posted} foot={foot} />
                </td>
                <td className={`${num}${muted}`}>
                  <Figure figure={row.accepted} foot={foot} />
                </td>
                <td className={`${num}${muted}`}>
                  <Figure figure={row.needsOffer} foot={foot} />
                </td>
                <td className={`${num}${muted}`}>
                  <Figure figure={row.pending} foot={foot} />
                </td>
                <td className={`${num}${muted}`}>
                  <Figure figure={row.unconfirmed} foot={foot} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
