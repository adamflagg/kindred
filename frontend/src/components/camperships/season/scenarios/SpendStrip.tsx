import { useCallback, useRef, useState } from 'react'

import type { ApiAidScenarioResults } from '../../../../types/api-types'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../../kit/aidStyles'
import {
  CS_CARD,
  CS_CARD_TITLE,
  CS_LABEL,
  CS_LINK,
  CS_META,
  CS_PILL,
  CS_SMALL,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
  CS_TH_CARD_NUM,
  CS_AMBER_NOTE,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { formatWholeMoney } from '../../kit/money'
import { poolBar, type PoolCardModel } from '../budgetCards'
import { AMBER_STRIPES, ROUND_SWATCH } from '../RoundsBudgetBar'
import { ScenarioPopover } from './ScenarioPopover'
import { REGISTRY_NOTE } from './scenarioNotes'
import { CHANGE_LESS, CHANGE_MORE, POOL_CELL } from './scenarioStyles'
import {
  belowParts,
  belowRows,
  byTierRows,
  projectionWords,
  stripLead,
  stripPools,
  type Change,
} from './spendModel'

const TD_NUM = `${CS_TD_CARD} text-right tabular-nums`
/** No change from the starting point: a muted dash, as the mock's `.none`. */
const NO_CHANGE = <span className="text-muted-foreground">—</span>

function ChangeMark({ change }: { change: Change | null }) {
  if (change === null) return null
  return (
    <span
      data-tone={change.tone}
      className={`${change.tone === 'more' ? CHANGE_MORE : CHANGE_LESS} ml-1 tabular-nums`}
    >
      {change.text}
    </span>
  )
}

/** The strip's 8px bar: PR 8's geometry (poolBar), amber past Allocated, and a dotted mark at the starting point. */
function StripBar({ card, ghostPct }: { card: PoolCardModel; ghostPct: number | null }) {
  const bar = poolBar(card)
  return (
    <div className="relative h-2 flex-1">
      <div className="bg-muted relative h-2 overflow-hidden rounded-full">
        {bar.fills.map((fill) => (
          <i
            key={fill.round}
            className={`absolute inset-y-0 ${ROUND_SWATCH[fill.round]}`}
            style={{ left: `${String(fill.leftPct)}%`, width: `${String(fill.widthPct)}%` }}
          />
        ))}
        {bar.overLeftPct !== null && (
          <i
            className={`absolute inset-y-0 ${AMBER_STRIPES}`}
            style={{ left: `${String(bar.overLeftPct)}%`, width: `${String(bar.overWidthPct)}%` }}
          />
        )}
      </div>
      {bar.overLeftPct !== null && (
        <b
          className="absolute -top-[3px] -bottom-[3px] border-l-2 border-dashed border-amber-600 dark:border-amber-300"
          style={{ left: `${String(bar.overLeftPct)}%` }}
        />
      )}
      {ghostPct !== null && (
        <b
          data-testid="strip-ghost"
          className="border-muted-foreground absolute -top-[3px] -bottom-[3px] border-l-2 border-dotted"
          style={{ left: `${String(ghostPct)}%` }}
        />
      )}
    </div>
  )
}

type Fold = 'below' | 'tier' | null

/**
 * The spend strip (Scenarios addendum §S5 E), sticky above the settings (owner: "STRIP ON TOP"). The draft's figures
 * and the starting point's both come from evaluate; the server does every sum, and the strip only words them,
 * colours each change (green leaves more money, amber less) and rounds a projection to $1,000. Projected figures
 * are never amber or red.
 */
export function SpendStrip({
  draft,
  from,
  stale,
  error,
  fromName,
  locked,
  postedStands,
  pricedOn,
  held,
}: {
  draft: ApiAidScenarioResults | null
  from: ApiAidScenarioResults | null
  stale: boolean
  error: string | null
  fromName: string
  locked: boolean
  postedStands: boolean
  pricedOn: string
  held: boolean
}) {
  const [fold, setFold] = useState<Fold>(null)
  const close = useCallback(() => setFold(null), [])
  const tierRef = useRef<HTMLButtonElement>(null)
  const belowRef = useRef<HTMLButtonElement>(null)
  if (!held || draft === null) {
    return (
      <div data-testid="spend-strip" className="bg-background sticky top-0 z-[25] pt-1">
        <div className={`${CS_CARD} flex items-baseline gap-3`}>
          <span className={CS_CARD_TITLE}>
            Spend
            <DefRef n={REGISTRY_NOTE.spend} />
          </span>
          <span className={CS_SMALL}>Update Applications to price the applications held.</span>
        </div>
      </div>
    )
  }
  const lead = stripLead(draft, from, postedStands)
  const pools = stripPools(draft, from, locked)
  const projection = projectionWords(draft.projection, locked)
  const toggle = (next: Exclude<Fold, null>) => setFold((was) => (was === next ? null : next))
  return (
    <div data-testid="spend-strip" className="bg-background sticky top-0 z-[25] pt-1">
      <div
        data-testid="spend-strip-card"
        data-stale={stale ? '' : undefined}
        className={`${CS_CARD} grid gap-2 data-[stale]:opacity-60`}
        style={{
          gridTemplateColumns: `minmax(190px, 230px) repeat(${String(Math.max(pools.length, 1))}, minmax(0, 1fr))`,
        }}
      >
        <div className="relative space-y-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className={CS_CARD_TITLE}>
              Spend
              <DefRef n={REGISTRY_NOTE.spend} />
            </span>
            <span className={CS_SMALL}>
              from <b>{fromName}</b>
            </span>
            <button
              ref={tierRef}
              type="button"
              className={`${CS_LINK} ${CS_SMALL} ml-auto`}
              onClick={() => toggle('tier')}
            >
              By tier ▸
            </button>
          </div>
          <div className={CS_SMALL}>
            Remaining
            <DefRef n={REGISTRY_NOTE.remaining} />
          </div>
          <div className="flex flex-wrap items-baseline gap-1">
            <b className={`tabular-nums ${lead.overBudget ? NEGATIVE_INK : ''}`}>
              {formatWholeMoney(lead.remaining)}
            </b>
            {lead.overBudget && <span className={CS_PILL.red}>over budget</span>}
            <ChangeMark change={lead.change} />
          </div>
          <div className={CS_SMALL}>{lead.ofWords}</div>
          <ScenarioPopover
            open={fold === 'tier'}
            onClose={close}
            anchor={tierRef}
            testId="tier-popover"
          >
            <div className={`${CS_LABEL} mb-1`}>{`By tier · ${pricedOn}`}</div>
            <table className={CS_TABLE_CARD}>
              <thead>
                <tr>
                  <th className={CS_TH_CARD}>Tier</th>
                  <th className={CS_TH_CARD_NUM}>Requests</th>
                  <th className={CS_TH_CARD_NUM}>Round 1</th>
                  {locked && <th className={CS_TH_CARD_NUM}>Round 2</th>}
                  <th className={CS_TH_CARD_NUM}>{`vs ${fromName}`}</th>
                </tr>
              </thead>
              <tbody>
                {byTierRows(draft, from, locked).map((row) => (
                  <tr key={row.tier}>
                    <td className={CS_TD_CARD}>{`Tier ${String(row.tier)}`}</td>
                    <td className={TD_NUM}>{row.requests}</td>
                    <td className={TD_NUM}>{row.round1}</td>
                    {locked && <td className={TD_NUM}>{row.round2}</td>}
                    <td className={TD_NUM}>
                      {row.change === null ? NO_CHANGE : <ChangeMark change={row.change} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScenarioPopover>
        </div>
        {pools.map((pool) => (
          <div
            key={pool.card.key}
            data-testid={`strip-pool-${pool.card.key}`}
            className={`${POOL_CELL} space-y-1`}
          >
            <div className="flex flex-wrap items-baseline gap-1">
              <span className={CS_LABEL}>{pool.card.label}</span>
              <span className={`${CS_META} ml-auto`}>Remaining</span>
              <b className={`tabular-nums ${pool.card.overShare ? POOL_NEGATIVE_INK : ''}`}>
                {formatWholeMoney(pool.card.remaining)}
              </b>
              {pool.card.overShare && <span className={CS_PILL.amber}>over its share</span>}
              <ChangeMark change={pool.remainingChange} />
            </div>
            <div className="flex items-center gap-2">
              <StripBar card={pool.card} ghostPct={pool.ghostPct} />
              {pool.projected !== null && (
                <span className={`${CS_SMALL} whitespace-nowrap`}>{pool.projected}</span>
              )}
            </div>
            <div className={`${CS_SMALL} flex flex-wrap gap-x-2`}>
              {pool.legend.map((item) => (
                <span key={item.round} className="inline-flex items-center gap-1 tabular-nums">
                  <i className={`inline-block h-2 w-2 rounded-sm ${ROUND_SWATCH[item.round]}`} />
                  {item.text}
                  <ChangeMark change={item.change} />
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="relative col-span-full flex flex-wrap items-baseline gap-x-3">
          {error !== null ? (
            <span className={CS_AMBER_NOTE}>{error}</span>
          ) : (
            projection !== null && (
              <span
                data-testid="strip-projection"
                data-dimmed={projection.dimmed ? '' : undefined}
                className={`${CS_META} data-[dimmed]:opacity-70`}
              >
                {projection.text}
                <DefRef n={REGISTRY_NOTE.projected} />
              </span>
            )
          )}
          <button
            ref={belowRef}
            type="button"
            className={`${CS_LINK} ${CS_META} ml-auto`}
            onClick={() => toggle('below')}
          >
            Below the line
            <DefRef n={REGISTRY_NOTE.below} />
            {': '}
            {belowParts(draft, locked).map((part, i) => (
              <span key={part.tail + part.lead}>
                {i > 0 && ' · '}
                {part.lead}
                <b className="text-foreground">{part.figure}</b>
                {part.tail}
              </span>
            ))}
            {' ▸'}
          </button>
          <ScenarioPopover
            open={fold === 'below'}
            onClose={close}
            anchor={belowRef}
            align="right"
            testId="below-popover"
          >
            <table className={CS_TABLE_CARD}>
              <thead>
                <tr>
                  <th className={CS_TH_CARD} />
                  <th className={CS_TH_CARD_NUM}>This draft</th>
                  <th className={CS_TH_CARD_NUM}>{fromName}</th>
                  <th className={CS_TH_CARD_NUM}>Change</th>
                </tr>
              </thead>
              <tbody>
                {belowRows(draft, from, locked).map((row) => (
                  <tr key={row.label}>
                    <td className={CS_TD_CARD}>{row.label}</td>
                    <td className={TD_NUM}>{row.draft}</td>
                    <td className={TD_NUM}>{row.from}</td>
                    <td className={TD_NUM}>{row.change === '' ? NO_CHANGE : row.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!locked && <p className={`${CS_SMALL} mt-1`}>Round 2: no appeals before Round 1.</p>}
          </ScenarioPopover>
        </div>
      </div>
    </div>
  )
}
