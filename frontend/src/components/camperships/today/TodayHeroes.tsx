import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type {
  ApiAidBudget,
  ApiAidBudgetPool,
  ApiAidDevelopmentSource,
  ApiAidTodayStages,
} from '../../../types/api-types'
import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_SMALL } from '../kit/csType'
import { AidHeroBar, AidHeroCard, AidHeroKeys, type HeroSegment } from '../kit/HeroBar'
import { formatMoneyCompact } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import {
  budgetSegments,
  developmentSegments,
  money,
  offerShare,
  overPools,
  registrarFlags,
  registrarSegments,
} from './todayModel'

/** The first mount plays the hero bar's reveal; a refetch redraws the page and must not replay it. */
let revealed = false

/** Whether this hero plays the page's one reveal (spec §3): only the first hero mounted since the page loaded. */
function useRevealOnce(): boolean {
  const [reveal] = useState(() => !revealed)
  useEffect(() => {
    revealed = true
  }, [])
  return reveal
}

export function RegistrarHero({
  stages,
  view,
}: {
  readonly stages: ApiAidTodayStages
  readonly view: AidView
}) {
  const reveal = useRevealOnce()
  const segments = registrarSegments(stages, view)
  const flags = registrarFlags(stages, view)
  const total = stages.live
  const share = offerShare(stages)
  return (
    <AidHeroCard
      title="The season so far"
      description={`${String(total)} requests from ${String(stages.families)} families · click any part to open it in Requests`}
      figure={share === null ? '—' : `${String(share)}%`}
      figureLabel="of live requests have an offer"
    >
      <AidHeroBar segments={segments} reveal={reveal} />
      <AidHeroKeys segments={segments} />
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {flags.map((f) => (
            <Link
              key={f.key}
              data-testid="hero-flag"
              to={f.href}
              title={`${f.label}: ${String(f.count)} on the Requests strip, at any stage`}
              className="hover:underline"
            >
              <StatusPill tone="amber">
                {f.label} <b className="tabular-nums">{String(f.count)}</b>
              </StatusPill>
            </Link>
          ))}
        </div>
      )}
    </AidHeroCard>
  )
}

const POOLS_HREF = '/aid/season/rounds-budget'
/** The mock's pool rows: 150px name, the bar, 120px Allocated, 130px Remaining; 13px, 6px apart, no rules between. */
const POOL_GRID = 'grid grid-cols-[150px_minmax(0,1fr)_120px_130px] items-center gap-x-3.5'
const POOL_ROW = `${POOL_GRID} py-[3px] text-[13px]`
/** Rounds & budget's no-pool bucket: money on programs the rules give no pool (budget.py NO_POOL). */
const NO_POOL = ''

function PoolRow({ pool, view }: { readonly pool: ApiAidBudgetPool; readonly view: AidView }) {
  const { segments, total, allocated } = budgetSegments(pool.total, pool.below)
  const remaining = pool.total.remaining
  const marker =
    allocated === null ? undefined : { at: allocated, title: `Allocated ${money(allocated)}` }
  return (
    <div data-testid="pool-row" className={POOL_ROW}>
      <Link
        to={aidHref(POOLS_HREF, view)}
        className="text-foreground truncate font-semibold hover:underline"
        title={pool.label}
      >
        {pool.label}
      </Link>
      {allocated === null ? (
        <span />
      ) : (
        <AidHeroBar segments={segments} total={total} compact {...(marker ? { marker } : {})} />
      )}
      <span className="text-right tabular-nums">
        {allocated === null ? '' : <Money value={allocated} />}
      </span>
      <span className="justify-self-end">
        {allocated === null || remaining === null ? (
          <StatusPill tone="muted">No allocation</StatusPill>
        ) : remaining >= 0 ? (
          <StatusPill tone="ok" title={`${money(remaining)} remaining`}>
            {formatMoneyCompact(remaining)} remaining
          </StatusPill>
        ) : (
          <StatusPill tone="amber" title={`${money(-remaining)} over`}>
            {formatMoneyCompact(-remaining)} over
          </StatusPill>
        )}
      </span>
    </div>
  )
}

export function FinanceHero({
  budget,
  view,
}: {
  readonly budget: ApiAidBudget
  readonly view: AidView
}) {
  const reveal = useRevealOnce()
  const { segments, total, allocated } = budgetSegments(budget.total.total, budget.total.below)
  const remaining = budget.total.total.remaining
  const over = overPools(budget)
  const marker =
    allocated === null ? undefined : { at: allocated, title: `Allocated ${money(allocated)}` }
  const negative = remaining !== null && remaining < 0
  return (
    <AidHeroCard
      title="Budget, all pools"
      description={`${allocated === null ? 'No allocation yet' : `${money(allocated)} allocated`} · every request waiting for an offer is priced under the rules`}
      figure={
        remaining === null ? (
          '—'
        ) : negative ? (
          <span className={POOL_NEGATIVE_INK}>{formatMoneyCompact(-remaining)}</span>
        ) : (
          formatMoneyCompact(remaining)
        )
      }
      figureLabel={
        negative
          ? 'over'
          : `remaining after everything waiting is offered${over.map((p) => ` · ${p.label} is ${money(p.over)} over`).join('')}`
      }
    >
      <AidHeroBar
        segments={segments}
        total={total}
        reveal={reveal}
        {...(marker ? { marker } : {})}
      />
      <AidHeroKeys segments={segments} />
      {/* One rule above the pool rows, none between them, under their own header (audit F2, F3). Money on no pool
          is not a pool: it is already in the bar's hatch, so it gets no row (ruling V3). */}
      <div className="border-border mt-3 border-t pt-2.5">
        <div data-testid="pool-head" className={`${POOL_GRID} ${CS_SMALL} pb-1`}>
          <span>Pool</span>
          <span />
          <span className="text-right">Allocated</span>
          <span className="text-right">Remaining</span>
        </div>
        {budget.pools
          .filter((pool) => pool.pool !== NO_POOL)
          .map((pool) => (
            <PoolRow key={pool.pool} pool={pool} view={view} />
          ))}
      </div>
    </AidHeroCard>
  )
}

const DEVELOPMENT_HREF = '/aid/reports/development'

export function DevelopmentHero({
  sources,
  awards,
  view,
}: {
  readonly sources: readonly ApiAidDevelopmentSource[]
  readonly awards: number | null
  readonly view: AidView
}) {
  const reveal = useRevealOnce()
  const built = developmentSegments(sources)
  const href = aidHref(DEVELOPMENT_HREF, view)
  const withDoor = (list: HeroSegment[]): HeroSegment[] => list.map((s) => ({ ...s, href }))
  const main = withDoor(built.main)
  const funders = withDoor(built.funders)
  const given = built.own + built.outside
  const pct = given > 0 ? Math.round((built.outside / given) * 100) : 0
  return (
    <AidHeroCard
      title="Where this season's aid came from"
      description={`${money(given)} given so far in ${String(view.year)} · live · no family is named on this page`}
      figure={awards === null ? '—' : String(awards)}
      figureLabel={`awards · ${String(pct)}% of the money from outside funders`}
    >
      <AidHeroBar segments={main} reveal={reveal} />
      <div className="mt-2.5 mb-1 text-[12.5px] font-semibold">
        <i className="mr-1.5 inline-block size-[9px] rounded-[2px] bg-sky-800" />
        {`Outside ${money(built.outside)}, by funder`}
      </div>
      <AidHeroBar segments={funders} mid />
      <AidHeroKeys segments={funders} />
    </AidHeroCard>
  )
}
