import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

import { aidHref, type AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import { GROUP_ROW, TABLE_CARD, TFOOT_CELL } from '../kit/kitStyles'
import { countWords } from '../requests/views'
import { NO_POOL, opensQueueViews, TOTAL_POOL, viewSlug } from './budgetModel'
import { demandMoney, heldWords, type DemandGroup, type DemandLine } from './demandModel'
import { RG_TABLE, RG_TD, RG_TD_NUM, RG_TH, RG_TH_NUM } from './rules/gridStyles'

const TOT_NUM = `${TFOOT_CELL} text-right tabular-nums`
const GROUP_META = 'text-muted-foreground ml-2 text-xs font-normal'

/** Held requests open the Held view, on the pool (none on a total); a past date and No pool open nothing. */
function heldHref(pool: string, held: DemandLine['held'], view: AidView): string | null {
  if (held === null || held.requests === 0 || pool === NO_POOL || !opensQueueViews(view))
    return null
  return aidHref('/aid/requests', view, {
    view: viewSlug('holds'),
    ...(pool === TOTAL_POOL ? {} : { pool }),
  })
}

function Cell({ href, children }: { href: string | null; children: ReactNode }) {
  return href === null ? (
    children
  ) : (
    <Link to={href} className={CS_LINK_CELL}>
      {children}
    </Link>
  )
}

/**
 * Demand still to come (spec §5.9, §7.2; D82; budget-demand.html E): asks, shown and never counted in Remaining. A
 * pool is a band row (No pool says what it is) over its two lines; the totals are two bold green-band rows (rounds-8).
 * Round 2's request counts and the held counts keep their drill links (rounds-m3). Each line's definition is its title.
 */
export function ForwardDemand({ groups, view }: { groups: readonly DemandGroup[]; view: AidView }) {
  if (groups.length === 0) return null
  const pools = groups.filter((g) => g.pool !== TOTAL_POOL)
  // The total rows: the server's total group, or (a one-pool page, one pool) that pool's own figures.
  const total =
    groups.find((g) => g.pool === TOTAL_POOL) ?? (pools.length === 1 ? pools[0] : undefined)
  const totalWho = total === undefined || total.pool === TOTAL_POOL ? 'Total' : total.label
  return (
    <div className={TABLE_CARD}>
      <table data-testid="forward-demand" className={RG_TABLE}>
        <thead>
          <tr>
            <th className={RG_TH}>Pool · line</th>
            <th className={RG_TH_NUM} style={{ width: 150 }}>
              Requests
            </th>
            <th className={RG_TH_NUM} style={{ width: 110 }}>
              Asked
            </th>
            <th className={RG_TH_NUM} style={{ width: 110 }}>
              Computed
            </th>
            <th className={RG_TH_NUM} style={{ width: 110 }}>
              Unmet ask
            </th>
            <th className={RG_TH_NUM} style={{ width: 180 }}>
              Held · asked
            </th>
          </tr>
        </thead>
        <tbody>
          {pools.map((group) => (
            <Fragment key={group.pool}>
              <tr>
                <td colSpan={6} className={`${GROUP_ROW} text-left`}>
                  {group.label}
                  {group.pool === NO_POOL && (
                    <span className={GROUP_META}>requests with no program yet</span>
                  )}
                </td>
              </tr>
              {group.lines.map((line) => (
                <tr key={line.key} data-demand-line={`${group.pool}:${line.key}`}>
                  <td className={`${RG_TD} pl-7`} title={line.title}>
                    {line.label}
                  </td>
                  <td className={RG_TD_NUM}>
                    <Cell href={line.href}>{countWords(line.requests)}</Cell>
                  </td>
                  <td className={RG_TD_NUM}>{demandMoney(line.asked)}</td>
                  <td className={RG_TD_NUM}>{demandMoney(line.computed)}</td>
                  <td className={RG_TD_NUM}>{demandMoney(line.unmet)}</td>
                  <td className={RG_TD_NUM}>
                    <Cell href={heldHref(group.pool, line.held, view)}>{heldWords(line)}</Cell>
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          {total?.lines.map((line) => (
            <tr
              key={`tot-${line.key}`}
              data-demand-line={`${total.pool}:${line.key}`}
              data-total=""
            >
              <td className={`${TFOOT_CELL} text-left`} title={line.title}>
                {`${totalWho} · ${line.label.replace(', not yet appealed', '')}`}
              </td>
              <td className={TOT_NUM}>
                <Cell href={line.href}>{countWords(line.requests)}</Cell>
              </td>
              <td className={TOT_NUM}>{demandMoney(line.asked)}</td>
              <td className={TOT_NUM}>{demandMoney(line.computed)}</td>
              <td className={TOT_NUM}>{demandMoney(line.unmet)}</td>
              <td className={TOT_NUM}>
                <Cell href={heldHref(total.pool, line.held, view)}>{heldWords(line)}</Cell>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
