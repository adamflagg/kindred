import { Inbox } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import {
  developmentCsvName,
  liveAwards,
} from '../../components/camperships/reports/developmentModel'
import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { AidBurnUp } from '../../components/camperships/kit/BurnUp'
import {
  CS_CARD_HEADING,
  CS_EMPTY,
  CS_LINK_SM,
  CS_SMALL,
} from '../../components/camperships/kit/csType'
import {
  countValue,
  moneyValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
} from '../../components/camperships/kit/report'
import { formatShortDate } from '../../components/camperships/kit/dates'
import { ReportTable } from '../../components/camperships/kit/ReportTable'
import { AidWeekCard } from '../../components/camperships/kit/WeekCard'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import {
  DevelopmentHero,
  FinanceHero,
  RegistrarHero,
} from '../../components/camperships/today/TodayHeroes'
import { TodayLayout } from '../../components/camperships/today/TodayLayout'
import {
  bandSentence,
  DEVELOPMENT_ORDER,
  developmentSegments,
  FINANCE_ORDER,
  money,
  overPools,
  pickTodayPage,
  rankLines,
  REGISTRAR_ORDER,
  reportingGroupRows,
  reportingGroupTotal,
  showRegistrarQueue,
  upkeepItems,
} from '../../components/camperships/today/todayModel'
import { TodayTodos } from '../../components/camperships/today/TodayTodos'
import { useAidBudget } from '../../hooks/camperships/useAidBudget'
import { useAidDevelopment } from '../../hooks/camperships/useAidDevelopment'
import { useAidToday } from '../../hooks/camperships/useAidToday'
import { useAidTodayWeek } from '../../hooks/camperships/useAidTodayWeek'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import type {
  ApiAidDevelopment,
  ApiAidToday,
  ApiAidTodayLine,
  ApiAidTodayWeek,
  ApiAidWeekFeed,
  ApiAidWeekFigure,
  ApiAidWeekPoint,
} from '../../types/api-types'
import PermissionDeniedPage from '../PermissionDeniedPage'

const LIVE = { kind: 'live' } as const

const live = (lines: readonly ApiAidTodayLine[]) => lines.filter((l) => l.items > 0)
const overdueCount = (lines: readonly ApiAidTodayLine[]) => lines.filter((l) => l.overdue).length
const overdueWords = (n: number) => (n > 0 ? ` · ${String(n)} overdue` : '')

/** A section heading with its muted meta beside it (the mock's `cf-h2` row). */
function Heading({ title, meta }: { readonly title: string; readonly meta: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <h2 className={CS_CARD_HEADING}>{title}</h2>
      {/* Audit N10: the meta fits, so it is never cut behind a hover title. */}
      <span className={CS_SMALL}>{meta}</span>
    </div>
  )
}

/** Where a feed item's words go; null leaves them plain. */
function weekHref(f: ApiAidWeekFeed): string | null {
  if (f.href_kind === 'household' && f.household_cm_id != null)
    return `/aid/households/${String(f.household_cm_id)}`
  if (f.href_kind === 'funders') return '/aid/money/funders'
  if (f.href_kind === 'rules') return '/aid/season/rules'
  return null
}

/**
 * A persona's right column: its own read inside its own guard, so a failed week read says so here and the to-dos
 * still render (spec 2026-10-10 §7.4). `extra` is the finance chart, drawn above the card and outside the guard: it
 * rides the Today read, so a slow or failed week read never hides it.
 */
function WeekColumn({
  pick,
  extra,
}: {
  readonly pick: (week: ApiAidTodayWeek) => readonly ApiAidWeekFigure[] | null | undefined
  readonly extra?: ReactNode
}) {
  const week = useAidTodayWeek()
  return (
    <>
      {extra}
      <QueryGuard
        isLoading={week.isLoading}
        error={week.data ? null : week.error}
        data={week.data}
        label="this week"
      >
        {(data) => (
          <AidWeekCard
            weekOf={data.week_of}
            figures={pick(data) ?? []}
            feed={data.feed}
            hrefOf={weekHref}
          />
        )}
      </QueryGuard>
    </>
  )
}

/**
 * Finance's This week figures (spec §7.2): You approved, Posted in CM, Avg award, Families helped. Posted in CM is the
 * budget's Posted by week, so it comes from the Today read's own rows (`posted_this_week`), not the week read.
 */
function financeFigures(
  week: readonly ApiAidWeekFigure[] | null | undefined,
  posted: ApiAidWeekFigure | null | undefined
): readonly ApiAidWeekFigure[] {
  const figures = week ?? []
  if (!posted) return figures
  const at = figures.findIndex((f) => f.key === 'approved') + 1
  return [...figures.slice(0, at), posted, ...figures.slice(at)]
}

/** Finance's chart: posted by week against the budget, and what is committed once waiting requests are offered. */
function CommittedByWeek({
  points,
  budget,
}: {
  readonly points: readonly ApiAidWeekPoint[]
  readonly budget: ReturnType<typeof useAidBudget>
}) {
  const total = budget.data?.total.total
  const first = points[0]
  // The mock's .v2-side card: the week card's header, then the chart padded 6px 10px 6px 14px.
  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="flex items-baseline gap-2 px-3.5 pt-[9px]">
        <h2 className={CS_CARD_HEADING}>Committed by week</h2>
        <span className={CS_SMALL}>
          {first ? `all pools · ${formatShortDate(first.week_of)} – today` : 'all pools'}
        </span>
      </div>
      <div className="pt-1.5 pr-2.5 pb-1.5 pl-3.5">
        <AidBurnUp
          points={points}
          budget={total?.allocated ?? null}
          committed={total?.committed ?? null}
        />
      </div>
    </section>
  )
}

function Band({ subtitle }: { readonly subtitle: string | undefined }) {
  return (
    <AidPageBand
      icon={Inbox}
      title="Good morning"
      {...(subtitle === undefined ? {} : { subtitle })}
      asOf={LIVE}
    />
  )
}

/** The page's skeleton: the band, then the one read behind a guard (a failed read says so; loading zeroes nothing). */
function TodayShell({
  today,
  subtitle,
  children,
}: {
  readonly today: ReturnType<typeof useAidToday>
  readonly subtitle: (data: ApiAidToday) => string
  readonly children: (data: ApiAidToday) => ReactNode
}) {
  return (
    <div className="space-y-2.5">
      <Band subtitle={today.data ? subtitle(today.data) : undefined} />
      <QueryGuard
        isLoading={today.isLoading}
        error={today.data ? null : today.error}
        data={today.data}
        label="Today"
      >
        {(data) => <div className="space-y-2.5">{children(data)}</div>}
      </QueryGuard>
    </div>
  )
}

function RegistrarBody({ today, view }: { today: ApiAidToday; view: AidView }) {
  const { top, rest } = rankLines(today.casework ?? [], REGISTRAR_ORDER)
  const waiting = top.length + live(rest).length
  return (
    <>
      {today.stages ? <RegistrarHero stages={today.stages} view={view} /> : null}
      <TodayLayout
        head={
          <Heading
            title="Your to-dos"
            meta={`${String(top.length)} of ${String(waiting)} waiting${overdueWords(overdueCount(top))} · overdue first, then a fixed order`}
          />
        }
        left={
          <TodayTodos lines={top} rest={rest} view={view} empty="Every casework queue is empty." />
        }
        right={<WeekColumn pick={(w) => w.registrar} />}
      />
      <AidDefinitionNotes surface="today_registrar" />
    </>
  )
}

function FinanceBody({
  today,
  budget,
  view,
}: {
  today: ApiAidToday
  budget: ReturnType<typeof useAidBudget>
  view: AidView
}) {
  const finance = today.finance ?? []
  const { top, rest } = rankLines(finance, FINANCE_ORDER)
  const waiting = top.length + live(rest).length

  const over = budget.data ? overPools(budget.data) : []
  const concerns: ApiAidTodayLine[] = [
    ...(over.length > 0
      ? [
          {
            // Built here, not sent: a key the server never sends, worded by LINE_WORDS and given no link.
            key: 'over_budget' as never,
            families: null,
            items: over.length,
            item_kind: 'lines' as const,
            reasons: over.map((p) => ({
              code: p.label,
              label: `${p.label} ${money(p.over)} over`,
              families: null,
              items: 0,
            })),
            overdue: false,
            next_up: [],
            names: [],
          } satisfies ApiAidTodayLine,
        ]
      : []),
    ...['intake', 'equity_field_never_true'].flatMap((key) =>
      live(finance.filter((l) => l.key === key))
    ),
  ]
  const registrar = showRegistrarQueue(today.finance) ? (today.casework ?? null) : null
  const queue = registrar === null ? null : rankLines(registrar, REGISTRAR_ORDER).top
  // The meta counts every live casework line, not just the five the fold shows.
  const queueLive = registrar === null ? [] : live(registrar)

  return (
    <>
      <QueryGuard
        isLoading={budget.isLoading}
        error={budget.data ? null : budget.error}
        data={budget.data}
        label="the budget"
      >
        {(data) => <FinanceHero budget={data} view={view} />}
      </QueryGuard>
      <TodayLayout
        head={
          <Heading
            title="Waiting on you"
            meta={`${String(waiting)} waiting${overdueWords(overdueCount(top))}`}
          />
        }
        left={
          <>
            <TodayTodos
              lines={top}
              rest={rest}
              view={view}
              empty="No approval, rules section or new description is waiting."
            />
            {concerns.length > 0 && (
              // The mock: 6px from a section heading to its table (audit X11).
              <div className="flex flex-col gap-1.5">
                <Heading
                  title="Concerns"
                  meta={`${String(concerns.length)} to know about · nothing here blocks a family`}
                />
                <TodayTodos
                  lines={concerns}
                  rest={[]}
                  view={view}
                  ranked={false}
                  nextHead="Why"
                  empty=""
                />
              </div>
            )}
            {queue !== null && queue.length > 0 && (
              // Ruling V4: always drawn, folded, with a link to the queue itself.
              <TodayTodos
                lines={[]}
                rest={queue}
                view={view}
                restTitle="The registrar's queue"
                restMeta={`${String(queueLive.length)} waiting${overdueWords(overdueCount(queueLive))} · on the registrar, open to review`}
                restActions={[
                  <Link key="requests" className={CS_LINK_SM} to={aidHref('/aid/requests', view)}>
                    Open Requests ›
                  </Link>,
                ]}
                empty=""
              />
            )}
          </>
        }
        right={
          <WeekColumn
            pick={(w) => financeFigures(w.finance, today.posted_this_week)}
            extra={<CommittedByWeek points={today.posted_by_week ?? []} budget={budget} />}
          />
        }
      />
      <AidDefinitionNotes surface="today_finance" />
    </>
  )
}

/** By reporting group's report rows: the model's groups (pool order, no group last), then the Every group total. */
function groupRows(dev: ApiAidDevelopment): ReportRow[] {
  const total = reportingGroupTotal(dev)
  return [
    ...reportingGroupRows(dev).map((g): ReportRow => ({
      key: g.key,
      kind: 'body',
      cells: [
        textValue(g.label),
        moneyValue(g.total),
        moneyValue(g.outside),
        countValue(g.campers),
      ],
    })),
    {
      key: 'every-group',
      kind: 'total',
      cells: [
        textValue('Every group'),
        moneyValue(total.total),
        moneyValue(total.outside),
        countValue(total.campers),
      ],
    },
  ]
}

// The mock's widths (audit D15): Group 220, Total aid 130, From outside funders 170, Campers helped the rest.
const GROUP_COLUMNS: readonly ReportColumn[] = [
  { key: 'group', header: 'Group', align: 'left', width: 220 },
  { key: 'total', header: 'Total aid', width: 130 },
  { key: 'outside', header: 'From outside funders', width: 170 },
  { key: 'campers', header: 'Campers helped' },
]

/** By reporting group (spec §7.3): the kit report table, its heading row carrying the description and Copy · CSV. */
function ByGroup({ dev, view }: { dev: ApiAidDevelopment; view: AidView }) {
  const rows = useMemo(() => groupRows(dev), [dev])
  const heading: ReportHeading = {
    title: 'By reporting group',
    season: dev.year,
    figuresOn: dev.figures_on,
    live: true,
    basis: null,
  }
  return (
    <ReportTable
      fixed
      heading={heading}
      description="live · the figures grant reports ask for"
      columns={GROUP_COLUMNS}
      rows={rows}
      csvFilename={developmentCsvName(view, 'by-group')}
      link={aidHref('/aid/today', view)}
    />
  )
}

function DevelopmentBody({
  today,
  dev,
  view,
}: {
  today: ApiAidToday
  dev: ReturnType<typeof useAidDevelopment>
  view: AidView
}) {
  const ranked = rankLines(today.development ?? [], DEVELOPMENT_ORDER)
  const { top } = ranked
  // Ruling V10: development's Everything else is drawn only when a line in it is waiting.
  const rest = live(ranked.rest).length > 0 ? ranked.rest : []
  // One count for the heading, the band and Upkeep left (audit D18): every item on every line. No last-week figure
  // exists for upkeep, so previous equals value and no change shows.
  const upkeepLeft = upkeepItems(today.development)
  return (
    <>
      <QueryGuard
        isLoading={dev.isLoading}
        error={dev.data ? null : dev.error}
        data={dev.data}
        label="the funder totals"
      >
        {(data) => <DevelopmentHero sources={data.sources} awards={liveAwards(data)} view={view} />}
      </QueryGuard>
      <TodayLayout
        head={
          <Heading
            title="Funder upkeep"
            meta={`${String(upkeepLeft)} waiting · keep these complete so reports come out right`}
          />
        }
        left={
          <>
            <TodayTodos
              lines={top}
              rest={rest}
              view={view}
              nextHead="Which"
              empty="Every funder has a contact, eligibility and a reporting group."
            />
            {/* Under Funder upkeep, in the left column (audit D10), as the mock lays it out. */}
            {dev.data ? <ByGroup dev={dev.data} view={view} /> : null}
          </>
        }
        right={
          <WeekColumn
            pick={(w) => [
              ...(w.development ?? []),
              {
                key: 'upkeep_left',
                label: 'Upkeep left',
                value: upkeepLeft,
                previous: upkeepLeft,
                unit: 'count',
              },
            ]}
          />
        }
      />
      <AidDefinitionNotes surface="today_development" />
    </>
  )
}

function ViewOnlyBody({ today, view }: { today: ApiAidToday; view: AidView }) {
  return (
    <>
      {today.stages ? <RegistrarHero stages={today.stages} view={view} /> : null}
      <div className={CS_EMPTY}>
        <b>Nothing is assigned to you.</b> Your role can read Camperships but has no queue of its
        own.
      </div>
    </>
  )
}

function RegistrarPersona({ view, viewOnly }: { view: AidView; viewOnly: boolean }) {
  const today = useAidToday()
  return (
    <TodayShell
      today={today}
      subtitle={(data) => bandSentence(viewOnly ? 'viewOnly' : 'registrar', data, undefined, null)}
    >
      {(data) =>
        viewOnly ? (
          <ViewOnlyBody today={data} view={view} />
        ) : (
          <RegistrarBody today={data} view={view} />
        )
      }
    </TodayShell>
  )
}

function FinancePersona({ view }: { view: AidView }) {
  const today = useAidToday()
  const budget = useAidBudget()
  return (
    <TodayShell today={today} subtitle={(data) => bandSentence('finance', data, budget.data, null)}>
      {(data) => <FinanceBody today={data} budget={budget} view={view} />}
    </TodayShell>
  )
}

function DevelopmentPersona({ view }: { view: AidView }) {
  const today = useAidToday()
  const dev = useAidDevelopment()
  const outside = dev.data ? developmentSegments(dev.data.sources).outside : null
  return (
    <TodayShell
      today={today}
      subtitle={(data) => bandSentence('development', data, undefined, outside)}
    >
      {(data) => <DevelopmentBody today={data} dev={dev} view={view} />}
    </TodayShell>
  )
}

/**
 * `/aid/today` (spec 2026-10-10 §2-§7): one home page per permission set (finance, registrar, development, or a
 * read-only user), all drawn from the one Today read. Development never sees a household: the server sends it
 * funder names only, and nothing on its page asks for a family.
 */
export default function AidTodayPage() {
  const { hasPermission } = usePermissions()
  const year = useYear()
  const view = useMemo((): AidView => ({ year, asOf: LIVE }), [year])
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // Today is live only (D20), and its budget read honours the URL's as-of: drop a past day from the URL rather than
  // let one hook draw a past budget under a "(live)" band. One redirect covers every read on the page.
  if (params.has('as_of') || params.has('as_of_axis')) {
    const kept = new URLSearchParams(params)
    kept.delete('as_of')
    kept.delete('as_of_axis')
    const search = kept.toString()
    return <Navigate to={search ? `${pathname}?${search}` : pathname} replace />
  }
  const page = pickTodayPage({ hasPermission })
  if (page === 'none') return <PermissionDeniedPage />
  if (page === 'finance') return <FinancePersona view={view} />
  if (page === 'development') return <DevelopmentPersona view={view} />
  return <RegistrarPersona view={view} viewOnly={page === 'viewOnly'} />
}
