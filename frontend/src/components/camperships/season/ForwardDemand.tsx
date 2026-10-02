import { Fragment } from 'react'
import { Link } from 'react-router'

import { DefRef } from '../kit/DefinitionNotes'
import { TABLE_CARD } from '../kit/kitStyles'
import { Money } from '../kit/MoneyText'
import { countWords } from '../requests/views'
import { heldWords, type DemandGroup } from './demandModel'
import { BELOW_HEADING, FIGURE_LINK, TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from './seasonStyles'

/**
 * Demand still to come (spec §5.9, §7.2; D82; budget-demand.html E): asks, shown and never counted
 * in Remaining. Each line's meaning is its note in the definitions registry (`round2_asks`,
 * `round1_unmet`), numbered beside the label like the table's columns.
 */
export function ForwardDemand({
  groups,
  numberOf,
}: {
  groups: readonly DemandGroup[]
  /** A line's note number on this surface (useAidDefinitions('season-rounds-budget').numberOf). */
  numberOf: (key: string) => number | null
}) {
  if (groups.length === 0) return null
  return (
    <section className="space-y-1.5" data-testid="forward-demand">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Demand still to come: asks, shown, never counted in Remaining
      </h2>
      <div className={TABLE_CARD}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL}>Pool · line</th>
              <th className={TH_MONEY}>Requests</th>
              <th className={TH_MONEY}>Asked</th>
              <th className={TH_MONEY}>Computed</th>
              <th className={TH_MONEY}>Unmet ask</th>
              <th className={TH_MONEY}>Held · asked</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              return (
                <Fragment key={group.pool}>
                  <tr>
                    <td colSpan={6} className={BELOW_HEADING}>
                      {group.label}
                    </td>
                  </tr>
                  {group.lines.map((line) => {
                    const n = numberOf(line.key)
                    return (
                      <tr key={line.key} data-demand-line={`${group.pool}:${line.key}`}>
                        <td className={`${TD_LABEL} pl-6`}>
                          {line.label}
                          {n !== null && <DefRef n={n} />}
                        </td>
                        <td className={TD_MONEY}>
                          {line.href === null ? (
                            countWords(line.requests)
                          ) : (
                            <Link to={line.href} className={`text-primary ${FIGURE_LINK}`}>
                              {countWords(line.requests)}
                            </Link>
                          )}
                        </td>
                        <td className={TD_MONEY}>
                          <Money value={line.asked} />
                        </td>
                        <td className={TD_MONEY}>
                          <Money value={line.computed} />
                        </td>
                        <td className={TD_MONEY}>
                          <Money value={line.unmet} />
                        </td>
                        <td className={TD_MONEY}>{heldWords(line)}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
