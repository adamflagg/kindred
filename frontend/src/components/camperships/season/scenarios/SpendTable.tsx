import { useMemo, useState, type ReactNode } from 'react'

import type { ApiAidScenarioResults } from '../../../../types/api-types'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../../kit/aidStyles'
import { CS_AMBER_NOTE } from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { formatWholeMoney } from '../../kit/money'
import { ReportTable } from '../../kit/ReportTable'
import type { ReportColumn, ReportHeading, ReportRow, ReportValue } from '../../kit/report'
import { REPORT_DESC, REPORT_TITLE } from '../../kit/reportStyles'
import { poolBar, type PoolCardModel } from '../budgetCards'
import { AMBER_STRIPES, ROUND_SWATCH } from '../RoundsBudgetBar'
import { REGISTRY_NOTE, PAGE_NOTE } from './scenarioNotes'
import { CHANGE_LESS, CHANGE_MORE } from './scenarioStyles'
import {
  belowParts,
  belowRows,
  byTierRows,
  kilo,
  projectedTitle,
  spendHeading,
  spendTable,
  type Change,
  type SpendRow,
} from './spendModel'

/** The copy and CSV buttons are off on these tables (`showHeading={false}`), so the heading only names the table. */
const heading = (title: string): ReportHeading => ({
  title,
  season: 0,
  figuresOn: '',
  live: true,
  basis: null,
})

const NO_CHANGE = <span className="text-muted-foreground">—</span>
/** The empty box's lead-in, as the mock's `.cf-empty b`: the bold words in the foreground ink. */
const EMPTY_BOX = (
  <>
    No applications are held yet. <b className="text-foreground">Update Applications</b> to price
    the applications held.
  </>
)

function ChangeMark({ change }: { change: Change | null }) {
  if (change === null) return NO_CHANGE
  return (
    <span
      data-tone={change.tone}
      className={`${change.tone === 'more' ? CHANGE_MORE : CHANGE_LESS} tabular-nums`}
    >
      {change.text}
    </span>
  )
}

/** The Used meter: PR 8's bar geometry (poolBar), amber past Allocated, and a dotted tick at the starting point. */
function UsedMeter({
  card,
  ghostPct,
  fromName,
}: {
  card: PoolCardModel
  ghostPct: number | null
  fromName: string
}) {
  const bar = poolBar(card)
  const allocated = card.allocated ?? 0
  const used = allocated > 0 ? Math.round((100 * (card.committed ?? 0)) / allocated) : 0
  return (
    <div
      className="relative mt-1.5 h-2 min-w-[90px]"
      title={`${String(used)}% of the pool's allocation · the dotted tick is where ${fromName} sits`}
    >
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
      {ghostPct !== null && (
        <b
          data-testid="spend-ghost"
          className="border-muted-foreground absolute -top-[3px] -bottom-[3px] border-l-2 border-dotted"
          style={{ left: `${String(ghostPct)}%` }}
        />
      )}
    </div>
  )
}

const money = (value: number | null): ReportValue => ({
  kind: 'money',
  value,
  display: formatWholeMoney(value),
})
const shown = (display: ReactNode, title?: string): ReportValue => ({
  kind: 'count',
  value: null,
  display,
  ...(title === undefined ? {} : { title }),
})

function spendRow(
  row: SpendRow,
  kind: 'body' | 'total',
  fromName: string,
  projected: string
): ReportRow {
  const ink = row.over ? (kind === 'total' ? NEGATIVE_INK : POOL_NEGATIVE_INK) : ''
  const overWords = kind === 'total' ? 'Over budget' : 'Over its share'
  return {
    key: row.key,
    kind,
    cells: [
      { kind: 'text', value: row.label, display: <b>{row.label}</b> },
      money(row.round1),
      money(row.round2),
      money(row.round3),
      { kind: 'money', value: row.spend, display: <b>{formatWholeMoney(row.spend)}</b> },
      {
        kind: 'money',
        value: row.remaining,
        display: <b className={ink}>{formatWholeMoney(row.remaining)}</b>,
        ...(row.over ? { title: overWords } : {}),
      },
      shown(<ChangeMark change={row.vs} />, `Remaining against ${fromName}`),
      row.projected === null
        ? { kind: 'money', value: null, display: '—', muted: true, title: projected }
        : {
            kind: 'money',
            value: row.projected,
            display: `≈${kilo(row.projected)}`,
            muted: true,
            title: projected,
          },
      {
        kind: 'text',
        value: '',
        display:
          row.card === null ? null : (
            <UsedMeter card={row.card} ghostPct={row.ghostPct} fromName={fromName} />
          ),
      },
    ],
  }
}

type Fold = 'below' | 'tier'

/** A fold heading as the mock's `.cf-fold`: ▸ or ▾, the title, and its summary muted on the same line. */
function FoldHeading({
  open,
  onToggle,
  title,
  summary,
}: {
  open: boolean
  onToggle: () => void
  title: ReactNode
  summary: string
}) {
  return (
    <div className="mt-4 mb-1.5 ml-0.5 flex min-h-7 flex-nowrap items-center gap-2.5">
      <button
        type="button"
        onClick={onToggle}
        className={`${REPORT_TITLE} text-foreground shrink-0 whitespace-nowrap hover:underline`}
      >
        <span className="text-muted-foreground inline-block w-3.5">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      <div className={REPORT_DESC} title={summary}>
        {summary}
      </div>
    </div>
  )
}

/**
 * The Spend table (final mock; scenarios-3), above the settings: one ruled row per pool and the total in the band,
 * Round 1 to 3, Spend, Remaining against the starting point, Projected and the Used meter. The server did every sum
 * (§S2 rule 2); spendModel picks and words them. Under it, By tier and Below the line fold open as ruled tables.
 * Projected figures are never amber or red.
 */
export function SpendTable({
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
  const [open, setOpen] = useState<ReadonlySet<Fold>>(new Set())
  const toggle = (fold: Fold) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(fold)) next.add(fold)
      return next
    })
  const table = useMemo(() => (draft === null ? null : spendTable(draft, from)), [draft, from])
  // Priced as if nothing is posted (owner, 2026-10-10), as the server says these figures were: what the season would
  // cost under these rules, not today's Remaining, and the labels say so.
  const fresh = draft?.as_if_unposted === true

  const columns: readonly ReportColumn[] = useMemo(
    () => [
      { key: 'pool', header: 'Pool', width: 176 },
      { key: 'round1', header: 'Round 1', width: 112 },
      {
        key: 'round2',
        header: locked ? 'Round 2, keyed so far' : 'Round 2',
        width: 150,
        title: locked ? 'Appeals keyed so far' : 'No appeals before Round 1: $0 until they exist',
      },
      {
        key: 'round3',
        header: 'Round 3',
        width: 96,
        title: 'Typed by staff, so no formula prices it: what is posted or keyed stands',
      },
      fresh
        ? {
            key: 'spend',
            header: 'Would cost',
            width: 112,
            divider: 'before',
            title: 'What this season would cost under these rules, as if nothing is posted',
          }
        : { key: 'spend', header: 'Spend', width: 112, divider: 'before' },
      fresh
        ? {
            key: 'remaining',
            header: 'Would remain',
            note: PAGE_NOTE.pricing,
            width: 120,
            title:
              'Allocated − what this season would cost under these rules, as if nothing is posted',
          }
        : { key: 'remaining', header: 'Remaining', note: REGISTRY_NOTE.remaining, width: 120 },
      {
        key: 'vs',
        header: `vs ${fromName}`,
        note: PAGE_NOTE.colours,
        title: `${fresh ? 'Would remain' : 'Remaining'} against ${fromName}`,
        width: 112,
      },
      {
        key: 'projected',
        header: 'Projected',
        note: REGISTRY_NOTE.projected,
        width: 104,
        divider: 'before',
      },
      {
        key: 'used',
        header: 'Used',
        align: 'left',
        title:
          "Spend against each pool's allocation, one shade per round; the dotted tick is the starting point",
      },
    ],
    [locked, fromName, fresh]
  )

  const title =
    draft === null || !held
      ? 'Spend'
      : `Spend${fresh ? ' as if nothing is posted' : ''}, from ${fromName}`
  const head = (
    <div className="mt-4 mb-1.5 ml-0.5 flex min-h-7 flex-nowrap items-center gap-2.5">
      <h2 className={`${REPORT_TITLE} min-w-0 truncate`} title={title}>
        {title}
        <DefRef n={REGISTRY_NOTE.spend} />
      </h2>
      <div className={REPORT_DESC}>
        {draft === null || !held
          ? 'nothing priced yet'
          : spendHeading(draft, postedStands, pricedOn)}
      </div>
    </div>
  )

  if (!held || draft === null || table === null) {
    return (
      <div data-testid="spend-table">
        {head}
        <ReportTable
          showHeading={false}
          heading={heading('Spend')}
          columns={columns}
          rows={[]}
          csvFilename="spend"
          link=""
          emptyBody={
            // Held but nothing priced: a failed read says why, never "nothing held" (scan of #3124).
            held && error !== null ? <p className={CS_AMBER_NOTE}>{error}</p> : EMPTY_BOX
          }
        />
      </div>
    )
  }

  const projected = projectedTitle(draft)
  const rows: ReportRow[] = [
    ...table.pools.map((pool) => spendRow(pool, 'body', fromName, projected)),
    spendRow(table.total, 'total', fromName, projected),
  ]

  const tierColumns: ReportColumn[] = [
    { key: 'tier', header: 'Tier' },
    { key: 'requests', header: 'Requests' },
    { key: 'round1', header: 'Round 1' },
    ...(locked ? [{ key: 'round2', header: 'Round 2' }] : []),
    { key: 'vs', header: `vs ${fromName}` },
  ]
  const tierRows: ReportRow[] = byTierRows(draft, from, locked).map((row) => ({
    key: String(row.tier),
    kind: 'body',
    cells: [
      { kind: 'text', value: `Tier ${String(row.tier)}` },
      shown(String(row.requests)),
      shown(row.round1),
      ...(locked ? [shown(row.round2)] : []),
      shown(<ChangeMark change={row.change} />),
    ],
  }))
  const belowColumns: ReportColumn[] = [
    { key: 'label', header: '' },
    { key: 'draft', header: 'This draft' },
    { key: 'from', header: fromName },
    { key: 'change', header: 'Change' },
  ]
  const belowTableRows: ReportRow[] = belowRows(draft, from, locked).map((row) => ({
    key: row.label,
    kind: 'body',
    cells: [
      { kind: 'text', value: row.label },
      shown(row.draft),
      shown(row.from),
      shown(row.change === '' ? NO_CHANGE : row.change),
    ],
  }))
  const belowSummary = belowParts(draft, locked)
    .map((part) => `${part.lead}${part.figure}${part.tail}`)
    .join(' · ')

  return (
    <div
      data-testid="spend-table"
      data-stale={stale ? '' : undefined}
      className="data-[stale]:opacity-60"
    >
      {head}
      <ReportTable
        showHeading={false}
        fixed
        heading={heading('Spend')}
        columns={columns}
        rows={rows}
        csvFilename="spend"
        link=""
      />
      {error !== null && <p className={`${CS_AMBER_NOTE} mt-1.5`}>{error}</p>}
      <div className="grid gap-x-4 xl:grid-cols-2 [&>div]:min-w-0">
        <div>
          <FoldHeading
            open={open.has('tier')}
            onToggle={() => toggle('tier')}
            title="By tier"
            summary={`Round 1 by tier · ${pricedOn}`}
          />
          {open.has('tier') && (
            <ReportTable
              showHeading={false}
              heading={heading('By tier')}
              columns={tierColumns}
              rows={tierRows}
              csvFilename="spend-by-tier"
              link=""
            />
          )}
        </div>
        <div>
          <FoldHeading
            open={open.has('below')}
            onToggle={() => toggle('below')}
            title={
              <>
                Below the line
                <DefRef n={REGISTRY_NOTE.below} />
              </>
            }
            summary={belowSummary}
          />
          {open.has('below') && (
            <ReportTable
              showHeading={false}
              heading={heading('Below the line')}
              columns={belowColumns}
              rows={belowTableRows}
              csvFilename="spend-below-the-line"
              link=""
            />
          )}
        </div>
      </div>
    </div>
  )
}
