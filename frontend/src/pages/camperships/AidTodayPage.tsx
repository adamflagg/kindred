import { Inbox } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'

import { QueryGuard } from '../../components/QueryGuard'
import {
  developmentCsvName,
  liveAwards,
} from '../../components/camperships/reports/developmentModel'
import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { CS_CARD_HEADING, CS_EMPTY, CS_META } from '../../components/camperships/kit/csType'
import { AidCopyButton, AidCsvButton } from '../../components/camperships/kit/CsvButton'
import {
  countValue,
  moneyValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
} from '../../components/camperships/kit/report'
import { ReportTable } from '../../components/camperships/kit/ReportTable'
import { useReportExport } from '../../components/camperships/kit/useReportExport'
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
  showRegistrarQueue,
} from '../../components/camperships/today/todayModel'
import { TodayTodos } from '../../components/camperships/today/TodayTodos'
import { useAidBudget } from '../../hooks/camperships/useAidBudget'
import { useAidDevelopment } from '../../hooks/camperships/useAidDevelopment'
import { useAidToday } from '../../hooks/camperships/useAidToday'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import type {
  ApiAidDevelopment,
  ApiAidDevelopmentSource,
  ApiAidToday,
  ApiAidTodayLine,
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
      <span className={CS_META}>{meta}</span>
    </div>
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
        right={null}
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
              <>
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
              </>
            )}
            {queue !== null && queue.length > 0 && (
              <TodayTodos
                lines={[]}
                rest={queue}
                view={view}
                restTitle="The registrar's queue"
                restMeta={`${String(live(queue).length)} waiting${overdueWords(overdueCount(queue))} · on the registrar, open to review`}
                empty=""
              />
            )}
          </>
        }
        right={null}
      />
      <AidDefinitionNotes surface="today_finance" />
    </>
  )
}

/** Sources grouped by reporting group: the table under Development's hero. Money and counts only, never a family. */
function groupRows(sources: readonly ApiAidDevelopmentSource[]): ReportRow[] {
  const groups = new Map<string, { total: number; outside: number; awards: number }>()
  for (const s of sources) {
    const label = s.group_label === '' ? 'Needs a group' : s.group_label
    const g = groups.get(label) ?? { total: 0, outside: 0, awards: 0 }
    g.total += s.amount
    if (s.who_paid === 'another funder') g.outside += s.amount
    g.awards += s.awards
    groups.set(label, g)
  }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([label, g]): ReportRow => ({
      key: label,
      kind: 'body',
      cells: [textValue(label), moneyValue(g.total), moneyValue(g.outside), countValue(g.awards)],
    }))
  const sum = (pick: (g: { total: number; outside: number; awards: number }) => number) =>
    [...groups.values()].reduce((a, g) => a + pick(g), 0)
  return [
    ...rows,
    {
      key: 'every-group',
      kind: 'total',
      cells: [
        textValue('Every group'),
        moneyValue(sum((g) => g.total)),
        moneyValue(sum((g) => g.outside)),
        countValue(sum((g) => g.awards)),
      ],
    },
  ]
}

const GROUP_COLUMNS: readonly ReportColumn[] = [
  { key: 'group', header: 'Group', align: 'left' },
  { key: 'total', header: 'Total aid', width: 130 },
  { key: 'outside', header: 'From outside funders', width: 170 },
  { key: 'awards', header: 'Awards', width: 100 },
]

function ByGroup({ dev, view }: { dev: ApiAidDevelopment; view: AidView }) {
  const rows = useMemo(() => groupRows(dev.sources), [dev.sources])
  const link = aidHref('/aid/today', view)
  const heading: ReportHeading = {
    title: 'By reporting group',
    season: dev.year,
    figuresOn: dev.figures_on,
    live: true,
    basis: null,
  }
  const exporter = useReportExport({
    heading,
    columns: GROUP_COLUMNS,
    rows,
    csvFilename: developmentCsvName(view, 'by-group'),
    link,
  })
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5">
        <h2 className={CS_CARD_HEADING}>By reporting group</h2>
        <span className={CS_META}>{exporter.failed ?? ''}</span>
        <span className="ml-auto flex items-center gap-2">
          <AidCopyButton copied={exporter.copied} onCopy={() => void exporter.copy()} />
          <AidCsvButton onDownload={exporter.download} />
        </span>
      </div>
      <ReportTable
        showHeading={false}
        fixed
        heading={heading}
        columns={GROUP_COLUMNS}
        rows={rows}
        csvFilename={developmentCsvName(view, 'by-group')}
        link={link}
      />
    </div>
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
  const { top, rest } = rankLines(today.development ?? [], DEVELOPMENT_ORDER)
  const waiting = top.length + live(rest).length
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
            meta={`${String(waiting)} waiting · keep these complete so reports come out right`}
          />
        }
        left={
          <TodayTodos
            lines={top}
            rest={rest}
            view={view}
            nextHead="Which"
            empty="Every funder has a contact, eligibility and a reporting group."
          />
        }
        right={null}
      />
      {dev.data ? <ByGroup dev={dev.data} view={view} /> : null}
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
  const page = pickTodayPage({ hasPermission })
  if (page === 'none') return <PermissionDeniedPage />
  if (page === 'finance') return <FinancePersona view={view} />
  if (page === 'development') return <DevelopmentPersona view={view} />
  return <RegistrarPersona view={view} viewOnly={page === 'viewOnly'} />
}
