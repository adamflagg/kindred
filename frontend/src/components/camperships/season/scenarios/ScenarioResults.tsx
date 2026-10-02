import type { ReactNode } from 'react'

import type { ApiAidScenarioResults } from '../../../../types/api-types'
import { AMBER_NOTE } from '../../../admin/lodging/lodgingStyles'
import { NEGATIVE_INK } from '../../kit/aidStyles'
import { TABLE_CARD } from '../../kit/kitStyles'
import { Money } from '../../kit/MoneyText'
import { TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from '../seasonStyles'
import { resultLines } from './scenarioModel'
import { DRAFT_CHIP, STRIP_CARD } from './scenarioStyles'

/**
 * What the figures shown are. While the live answer is on its way, or failed, they are the draft as
 * recorded, and say so (T17-m8).
 */
const STATE_WORDS = {
  recorded: 'The draft as recorded',
  moving: 'Moving: recorded when you let go',
  updating: 'The draft as recorded',
  failed: "The live figures couldn't be worked out: these are the draft as recorded",
} as const

/**
 * A scenario's figures (spec §7.4; results.py): the strip's one line, then where Round 1 lands by
 * pool and by tier. `state` says whether these are the draft as recorded or a slider still moving.
 */
export function ScenarioResults({
  results,
  state,
  actions,
  liveError = null,
}: {
  results: ApiAidScenarioResults
  state: 'recorded' | 'moving' | 'updating' | 'failed'
  /** The Keep buttons, right-aligned in the strip as the mock has them. */
  actions?: ReactNode
  /** Why the live figures failed, said in the strip so no line pushes the sliders mid-drag. */
  liveError?: string | null
}) {
  return (
    <div className="space-y-2" data-testid="scenario-results">
      <div className={STRIP_CARD}>
        <span className={DRAFT_CHIP}>Draft</span>
        <span className="text-muted-foreground text-xs">{STATE_WORDS[state]}</span>
        {liveError !== null && <span className={AMBER_NOTE}>{liveError}</span>}
        {state === 'updating' && <span className="text-muted-foreground text-xs">updating…</span>}
        {resultLines(results).map((line) => (
          <span key={line.key} className="whitespace-nowrap">
            <span className="text-muted-foreground">{line.label}</span>{' '}
            <b className={line.negative ? `tabular-nums ${NEGATIVE_INK}` : 'tabular-nums'}>
              {line.value}
            </b>
          </span>
        ))}
        {actions !== undefined && <span className="ml-auto flex flex-wrap gap-2">{actions}</span>}
      </div>
      <div className={TABLE_CARD}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL}>Pool</th>
              <th className={TH_MONEY}>Round 1</th>
              {/* The strip's own qualifiers: Round 2 is no estimate (plan ruling), and Remaining
                  takes every round off (T17-⚠1, owner queue). */}
              <th className={TH_MONEY}>Round 2 (appeals keyed so far)</th>
              <th className={TH_MONEY}>Round 3</th>
              <th className={TH_MONEY}>Round 1 remaining</th>
              <th className={TH_MONEY}>Remaining (every round)</th>
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
