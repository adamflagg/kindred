import type { ApiAidScenarioResults } from '../../../../types/api-types'
import { NEGATIVE_INK } from '../../kit/aidStyles'
import { TABLE_CARD } from '../../kit/kitStyles'
import { Money } from '../../kit/MoneyText'
import { TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from '../seasonStyles'
import { resultLines } from './scenarioModel'

/**
 * A scenario's figures (spec §7.4; results.py): the strip's one line, then where Round 1 lands by
 * pool and by tier. `state` says whether these are the draft as recorded or a slider still moving.
 */
export function ScenarioResults({
  results,
  state,
}: {
  results: ApiAidScenarioResults
  state: 'recorded' | 'moving' | 'working'
}) {
  return (
    <div className="space-y-2" data-testid="scenario-results">
      <div className="card-lodge flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="text-muted-foreground text-xs">
          {state === 'recorded'
            ? 'The draft as recorded'
            : state === 'moving'
              ? 'Moving: recorded when you let go'
              : 'Working it out…'}
        </span>
        {resultLines(results).map((line) => (
          <span key={line.key} className="whitespace-nowrap">
            <span className="text-muted-foreground">{line.label}</span>{' '}
            <b className={line.negative ? `tabular-nums ${NEGATIVE_INK}` : 'tabular-nums'}>
              {line.value}
            </b>
          </span>
        ))}
      </div>
      {results.request_set && (
        <p className="text-sm font-medium">{`Figures on ${results.request_set.label}`}</p>
      )}
      <div className={TABLE_CARD}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL}>Pool</th>
              <th className={TH_MONEY}>Round 1</th>
              <th className={TH_MONEY}>Round 2</th>
              <th className={TH_MONEY}>Round 3</th>
              <th className={TH_MONEY}>Round 1 remaining</th>
              <th className={TH_MONEY}>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {results.pools.map((pool) => (
              <tr key={pool.pool}>
                <td className={TD_LABEL}>{pool.label}</td>
                <td className={TD_MONEY}>
                  <Money value={pool.round1} />
                </td>
                <td className={TD_MONEY}>
                  <Money value={pool.round2} />
                </td>
                <td className={TD_MONEY}>
                  <Money value={pool.round3} />
                </td>
                <td className={TD_MONEY}>
                  <Money value={pool.round1_remaining} />
                </td>
                <td className={TD_MONEY}>
                  <Money value={pool.remaining} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={TABLE_CARD}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL}>Tier</th>
              <th className={TH_MONEY}>Requests</th>
              <th className={TH_MONEY}>Families</th>
              <th className={TH_MONEY}>Round 1</th>
            </tr>
          </thead>
          <tbody>
            {results.by_tier.map((row) => (
              <tr key={row.tier}>
                <td className={TD_LABEL}>{`Tier ${String(row.tier)}`}</td>
                <td className={TD_MONEY}>{row.requests}</td>
                <td className={TD_MONEY}>{row.families}</td>
                <td className={TD_MONEY}>
                  <Money value={row.round1} />
                </td>
              </tr>
            ))}
            {results.not_in_tiers !== 0 && (
              <tr>
                <td className={TD_LABEL}>In no tier</td>
                <td className={TD_MONEY} />
                <td className={TD_MONEY} />
                <td className={TD_MONEY}>
                  <Money value={results.not_in_tiers} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
