import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import type { AidView } from '../kit/asOf'
import {
  CS_AMBER_NOTE,
  CS_LINK_CELL,
  CS_META,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
  CS_TH_CARD_NUM,
} from '../kit/csType'
import { Money } from '../kit/MoneyText'
import { roundLines } from './budgetCards'

/** The rounds table inside a card (§5.2 D): the same for the total and each pool. Never Allocated or Remaining per round. */
export function RoundsTable({
  budget,
  poolKey,
  view,
  numberOf,
}: {
  budget: ApiAidBudget
  poolKey: string
  view: AidView
  numberOf: (key: string) => number | null
}) {
  const n = (key: string) => {
    const at = numberOf(key)
    return at === null ? null : <DefRef n={at} />
  }
  return (
    <table data-testid="rounds-table" className={`${CS_TABLE_CARD} mt-2 w-full`}>
      <thead>
        <tr>
          <th className={CS_TH_CARD}>Round</th>
          <th className={CS_TH_CARD_NUM}>Committed{n('committed')}</th>
          <th className={CS_TH_CARD}>What is committed</th>
        </tr>
      </thead>
      <tbody>
        {roundLines(budget, poolKey, view).map((line) => (
          <tr key={line.round} data-round={line.round}>
            <td className={CS_TD_CARD}>{`Round ${String(line.round)}`}</td>
            <td className={`${CS_TD_CARD} text-right`}>
              <Money value={line.committed} />
            </td>
            <td className={`${CS_TD_CARD} whitespace-normal`}>
              <span className={CS_META}>
                {line.parts.map((part, i) => (
                  <span key={part.label}>
                    {i > 0 && ' · '}
                    {part.label}
                    {n(part.note)}{' '}
                    {part.href === null ? (
                      part.words
                    ) : (
                      <Link to={part.href} className={CS_LINK_CELL}>
                        {part.words}
                      </Link>
                    )}
                  </span>
                ))}
              </span>
              {line.confirmed !== null && (
                <span className={`${CS_AMBER_NOTE} ml-1.5`}>
                  {line.confirmed.href === null ? (
                    line.confirmed.words
                  ) : (
                    <Link to={line.confirmed.href} className="hover:underline">
                      {line.confirmed.words}
                    </Link>
                  )}
                  {n('unconfirmed')}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
