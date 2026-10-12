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
import { CS_META } from '../kit/csType'
import { AidHeroBar, AidHeroCard, AidHeroKeys, type HeroSegment } from '../kit/HeroBar'
import { StatusPill } from '../kit/Pills'
import { REQUEST_VIEWS } from '../requests/views'
import {
  budgetSegments,
  developmentSegments,
  money,
  offerShare,
  overPools,
  registrarSegments,
  thousands,
} from './todayModel'

/** The first mount plays the hero bar's reveal; a refetch redraws the page and must not replay it. */
let revealed = false

/** A stage's Requests view slug, from the grid's own view list (`held` is the Holds view). */
function stageSlug(stage: string): string {
  const key = stage === 'held' ? 'holds' : stage
  return REQUEST_VIEWS.find((v) => v.key === key)?.slug ?? 'all'
}

export function RegistrarHero({
  stages,
  view,
}: {
  readonly stages: ApiAidTodayStages
  readonly view: AidView
}) {
  const [reveal] = useState(() => !revealed)
  useEffect(() => {
    revealed = true
  }, [])
  const total =
    stages.accepted +
    stages.waiting_on_family +
    stages.pending_approval +
    stages.needs_offer +
    stages.held +
    stages.cancelled
  const share = offerShare(stages)
  const segments = registrarSegments(stages, (stage) =>
    aidHref('/aid/requests', view, { view: stageSlug(stage) })
  ).map((s): HeroSegment =>
    s.key === 'accepted' && stages.posted_this_week > 0
      ? {
          ...s,
          pill: (
            <StatusPill tone="ok" title="Posted this week">
              +{stages.posted_this_week}
            </StatusPill>
          ),
        }
      : s
  )
  return (
    <AidHeroCard
      title="The season so far"
      description={`${String(total)} requests from ${String(stages.families)} families · click any part to open it in Requests`}
      figure={share === null ? '—' : `${String(share)}%`}
      figureLabel="of live requests have an offer"
    >
      <AidHeroBar segments={segments} reveal={reveal} />
      <AidHeroKeys segments={segments} />
    </AidHeroCard>
  )
}

const POOLS_HREF = '/aid/season/rounds-budget'
const POOL_ROW = 'grid grid-cols-[150px_minmax(0,1fr)_120px_130px] items-center gap-x-3 py-1.5'

function PoolRow({ pool, view }: { readonly pool: ApiAidBudgetPool; readonly view: AidView }) {
  const { segments, total, allocated } = budgetSegments(pool.total, pool.below)
  const remaining = pool.total.remaining
  const marker =
    allocated === null ? undefined : { at: allocated, title: `Allocated ${money(allocated)}` }
  return (
    <div data-testid="pool-row" className={POOL_ROW}>
      <Link
        to={aidHref(POOLS_HREF, view)}
        className="text-foreground truncate text-[13.5px] font-semibold hover:underline"
        title={pool.label}
      >
        {pool.label}
      </Link>
      {allocated === null ? (
        <span />
      ) : (
        <AidHeroBar segments={segments} total={total} compact {...(marker ? { marker } : {})} />
      )}
      <span className={`${CS_META} tabular-nums`}>
        {allocated === null ? '' : `${money(allocated)} allocated`}
      </span>
      {allocated === null || remaining === null ? (
        <StatusPill tone="muted">No allocation</StatusPill>
      ) : remaining >= 0 ? (
        <StatusPill tone="ok" title={`${money(remaining)} remaining`}>
          {thousands(remaining)} remaining
        </StatusPill>
      ) : (
        <StatusPill tone="amber" title={`${money(-remaining)} over`}>
          {thousands(-remaining)} over
        </StatusPill>
      )}
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
          <span className={POOL_NEGATIVE_INK}>{thousands(-remaining)}</span>
        ) : (
          thousands(remaining)
        )
      }
      figureLabel={
        negative
          ? 'over'
          : `remaining after everything waiting is offered${over.map((p) => ` · ${p.label} is ${money(p.over)} over`).join('')}`
      }
    >
      <AidHeroBar segments={segments} total={total} {...(marker ? { marker } : {})} />
      <AidHeroKeys segments={segments} />
      <div className="border-border mt-2.5 divide-y border-t">
        {budget.pools.map((pool) => (
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
      <AidHeroBar segments={main} />
      <div className="mt-2.5 mb-1 text-[12.5px] font-semibold">
        <i className="mr-1.5 inline-block size-[9px] rounded-[2px] bg-sky-800" />
        {`Outside ${money(built.outside)}, by funder`}
      </div>
      <AidHeroBar segments={funders} mid />
      <AidHeroKeys segments={funders} />
    </AidHeroCard>
  )
}
