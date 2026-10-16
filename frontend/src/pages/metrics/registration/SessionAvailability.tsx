import { useState, useCallback, useMemo } from 'react'
import { formatCount } from '../../../utils/numberFormat'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import {
  useSessionAvailability,
  type SessionAvailabilityData,
  type AGSessionAvailabilityData,
  type TeenSessionAvailabilityData,
  type WaitlistedPerson,
} from '../../../hooks/useSessionAvailability'
import { splitCampAndQuest } from '../../../utils/sessionUtils'
import { sessionName } from '../../../utils/sessionName'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import { WaitlistTooltip } from '../../../components/metrics/WaitlistTooltip'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { useTableSort } from '../../../hooks/useTableSort'
import { MetricSortHeader } from '../../../components/metrics/MetricSortHeader'
import { TableExportButtons } from '../../../components/metrics/TableExportButtons'
import { csvFilename } from '../../../components/metrics/exportFilename'
import type { SortValue } from '../../../utils/tableSort'

const GRADES = [2, 3, 4, 5, 6, 7, 8, 9, 10]
// Teen programs only serve rising-11th (TLI) and rising-12th (SCIT) graders,
// so their box shows just these two columns instead of the full camp range.
const TEEN_GRADES = [11, 12]

function gradeLabel(grade: number): string {
  if (grade === 2) return '2nd'
  if (grade === 3) return '3rd'
  return `${grade}th`
}

type Status = 'open' | 'limited' | 'full' | 'na'

function statusForGrade(
  gender: { min_grade: number | null; max_grade: number | null; status: string },
  grade: number
): Status {
  const min = gender.min_grade
  const max = gender.max_grade
  if (min !== null && max !== null && (grade < min || grade > max)) {
    return 'na'
  }
  return gender.status as Status
}

function cellClass(status: Status): string {
  const base = 'min-w-[2.5rem] px-2 py-2 text-center border border-border/50'
  switch (status) {
    case 'open':
      return `${base} bg-emerald-100 dark:bg-emerald-900/40`
    case 'limited':
      return `${base} bg-amber-200 dark:bg-amber-800/50`
    case 'full':
      return `${base} bg-red-200 dark:bg-red-900/50`
    case 'na':
      return `${base} bg-neutral-200 dark:bg-neutral-700`
  }
}

type AvailField = 'name' | 'girlsOpen' | 'girlsWl' | 'boysOpen' | 'boysWl'

/** Open spots in one gender's box, or null when the box has no capacity to count against. */
function openSpots(g: { capacity: number | null; enrolled: number }): number | null {
  return g.capacity === null ? null : g.capacity - g.enrolled
}

function availSortValue(session: SessionAvailabilityData, field: AvailField): SortValue {
  switch (field) {
    case 'name':
      return session.session_name
    case 'girlsOpen':
      return openSpots(session.girls)
    case 'girlsWl':
      return session.girls.waitlisted
    case 'boysOpen':
      return openSpots(session.boys)
    case 'boysWl':
      return session.boys.waitlisted
  }
}

interface AvailSort {
  direction: (field: AvailField) => 'ascending' | 'descending' | null
  toggle: (field: AvailField) => void
}

const AVAIL_HEADERS = [
  'Session',
  'Group',
  'Gender',
  'Enrolled',
  'Capacity',
  'Open spots',
  'Status',
  'Waitlisted',
  ...GRADES.flatMap((g) => [`${gradeLabel(g)} status`, `${gradeLabel(g)} waitlisted`]),
]

/** The matrix as a file: one row per session and gender (AG and teen programs have one box, gender "All"). */
function availabilityRows(
  groups: ReadonlyArray<{ label: string; sessions: readonly SessionAvailabilityData[] }>,
  ag: readonly AGSessionAvailabilityData[],
  teen: readonly TeenSessionAvailabilityData[]
): Array<Array<string | number | null>> {
  const out: Array<Array<string | number | null>> = []
  for (const group of groups) {
    for (const session of group.sessions) {
      for (const gender of ['girls', 'boys'] as const) {
        const box = session[gender]
        out.push([
          session.session_name,
          group.label,
          gender === 'girls' ? 'Girls' : 'Boys',
          box.enrolled,
          box.capacity,
          openSpots(box),
          box.status,
          box.waitlisted,
          ...GRADES.flatMap((g) => [statusForGrade(box, g), box.waitlisted_by_grade[g] ?? 0]),
        ])
      }
    }
  }
  const single = (
    label: string,
    s: AGSessionAvailabilityData | TeenSessionAvailabilityData,
    grades: readonly number[]
  ) => [
    s.session_name,
    label,
    'All',
    s.enrolled,
    s.capacity,
    openSpots(s),
    s.status,
    s.waitlisted,
    ...GRADES.flatMap((g) =>
      grades.includes(g) ? [statusForGrade(s, g), s.waitlisted_by_grade[g] ?? 0] : ['na', 0]
    ),
  ]
  for (const s of ag) out.push(single('AG Sessions', s, GRADES))
  for (const s of teen) out.push(single('Teen Programs', s, TEEN_GRADES))
  return out
}

interface WaitlistHandlers {
  onHover?: (
    e: React.MouseEvent,
    totalCount: number,
    genderLabel: string,
    persons: WaitlistedPerson[],
    gradeSuffix?: string
  ) => void
  onMove?: (e: React.MouseEvent) => void
  onLeave?: () => void
  onCellClick?: (
    sessionCmId: number,
    sessionName: string,
    genderCode: string,
    genderLabel: string,
    totalCount: number,
    grade?: number
  ) => void
}

function SessionRow({
  session,
  gender,
  onHover,
  onMove,
  onLeave,
  onCellClick,
}: {
  session: SessionAvailabilityData
  gender: 'girls' | 'boys'
} & WaitlistHandlers) {
  const genderData = session[gender]
  const hasWaitlist = genderData.waitlisted > 0
  const genderCode = gender === 'girls' ? 'F' : 'M'

  return (
    <>
      {GRADES.map((g) => {
        const status = statusForGrade(genderData, g)
        const wlCount = genderData.waitlisted_by_grade[g] ?? 0
        return (
          <td
            key={g}
            className={[cellClass(status), wlCount > 0 && 'cursor-pointer']
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={
              wlCount > 0
                ? (e) => onHover?.(e, wlCount, gender, [], `(${gradeLabel(g)})`)
                : undefined
            }
            onMouseMove={wlCount > 0 ? (e) => onMove?.(e) : undefined}
            onMouseLeave={wlCount > 0 ? () => onLeave?.() : undefined}
            onClick={
              wlCount > 0
                ? () =>
                    onCellClick?.(
                      session.session_cm_id,
                      session.session_name,
                      genderCode,
                      gender,
                      genderData.waitlisted,
                      g
                    )
                : undefined
            }
          >
            {wlCount > 0 && (
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
                {formatCount(wlCount)}
              </span>
            )}
          </td>
        )
      })}
      {/* WL pill column */}
      <td className="border-border/50 min-w-[2.5rem] border px-2 py-2 text-center">
        {hasWaitlist ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            onMouseEnter={(e) =>
              onHover?.(e, genderData.waitlisted, gender, genderData.waitlisted_persons)
            }
            onMouseMove={(e) => onMove?.(e)}
            onMouseLeave={() => onLeave?.()}
            onClick={() =>
              onCellClick?.(
                session.session_cm_id,
                session.session_name,
                genderCode,
                gender,
                genderData.waitlisted
              )
            }
          >
            {formatCount(genderData.waitlisted)}
          </button>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
    </>
  )
}

function AGSessionRow({
  session,
  onHover,
  onMove,
  onLeave,
  onCellClick,
}: {
  session: AGSessionAvailabilityData
} & WaitlistHandlers) {
  const hasWaitlist = session.waitlisted > 0

  return (
    <>
      {GRADES.map((g) => {
        const status = statusForGrade(
          { min_grade: session.min_grade, max_grade: session.max_grade, status: session.status },
          g
        )
        const wlCount = session.waitlisted_by_grade[g] ?? 0
        return (
          <td
            key={g}
            className={[cellClass(status), wlCount > 0 && 'cursor-pointer']
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={
              wlCount > 0 ? (e) => onHover?.(e, wlCount, '', [], `(${gradeLabel(g)})`) : undefined
            }
            onMouseMove={wlCount > 0 ? (e) => onMove?.(e) : undefined}
            onMouseLeave={wlCount > 0 ? () => onLeave?.() : undefined}
            onClick={
              wlCount > 0
                ? () =>
                    onCellClick?.(
                      session.session_cm_id,
                      session.session_name,
                      '',
                      '',
                      session.waitlisted,
                      g
                    )
                : undefined
            }
          >
            {wlCount > 0 && (
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
                {formatCount(wlCount)}
              </span>
            )}
          </td>
        )
      })}
      {/* WL pill column */}
      <td className="border-border/50 min-w-[2.5rem] border px-2 py-2 text-center">
        {hasWaitlist ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            onMouseEnter={(e) => onHover?.(e, session.waitlisted, '', session.waitlisted_persons)}
            onMouseMove={(e) => onMove?.(e)}
            onMouseLeave={() => onLeave?.()}
            onClick={() =>
              onCellClick?.(session.session_cm_id, session.session_name, '', '', session.waitlisted)
            }
          >
            {formatCount(session.waitlisted)}
          </button>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
    </>
  )
}

function TeenSessionRow({
  session,
  onHover,
  onMove,
  onLeave,
  onTeenCellClick,
}: {
  session: TeenSessionAvailabilityData
  /** Teen rows share session_cm_id=0, so the drilldown keys off teen type. */
  onTeenCellClick?: (teenType: string, sessionName: string, grade?: number) => void
} & Omit<WaitlistHandlers, 'onCellClick'>) {
  const hasWaitlist = session.waitlisted > 0

  return (
    <>
      {TEEN_GRADES.map((g) => {
        const status = statusForGrade(
          { min_grade: session.min_grade, max_grade: session.max_grade, status: session.status },
          g
        )
        const wlCount = session.waitlisted_by_grade[g] ?? 0
        return (
          <td
            key={g}
            className={[cellClass(status), wlCount > 0 && 'cursor-pointer']
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={
              wlCount > 0 ? (e) => onHover?.(e, wlCount, '', [], `(${gradeLabel(g)})`) : undefined
            }
            onMouseMove={wlCount > 0 ? (e) => onMove?.(e) : undefined}
            onMouseLeave={wlCount > 0 ? () => onLeave?.() : undefined}
            onClick={
              wlCount > 0
                ? () => onTeenCellClick?.(session.session_type, session.session_name, g)
                : undefined
            }
          >
            {wlCount > 0 && (
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
                {formatCount(wlCount)}
              </span>
            )}
          </td>
        )
      })}
      {/* WL pill column */}
      <td className="border-border/50 min-w-[2.5rem] border px-2 py-2 text-center">
        {hasWaitlist ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            onMouseEnter={(e) => onHover?.(e, session.waitlisted, '', session.waitlisted_persons)}
            onMouseMove={(e) => onMove?.(e)}
            onMouseLeave={() => onLeave?.()}
            onClick={() => onTeenCellClick?.(session.session_type, session.session_name)}
          >
            {formatCount(session.waitlisted)}
          </button>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
    </>
  )
}

function Legend() {
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-3 text-xs"
      data-tour="reg-availability-legend"
    >
      <span className="flex items-center gap-1">
        <span className="border-border/50 h-5 w-5 rounded border bg-emerald-100 dark:bg-emerald-900/40" />
        Open Space
      </span>
      <span className="flex items-center gap-1">
        <span className="border-border/50 h-5 w-5 rounded border bg-amber-200 dark:bg-amber-800/50" />
        Limited Space
      </span>
      <span className="flex items-center gap-1">
        <span className="border-border/50 h-5 w-5 rounded border bg-red-200 dark:bg-red-900/50" />
        Full
      </span>
      <span className="flex items-center gap-1">
        <span className="border-border/50 h-5 w-5 rounded border bg-neutral-200 dark:bg-neutral-700" />
        N/A
      </span>
      <span className="flex items-center gap-1">
        <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">4</span>
        Waitlisted (grade)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
          12
        </span>
        Waitlisted (total)
      </span>
    </div>
  )
}

function SessionsTable({
  sessions,
  handlers,
  sort,
}: {
  sessions: SessionAvailabilityData[]
  handlers: WaitlistHandlers
  sort: AvailSort
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <MetricSortHeader
              bare
              rowSpan={2}
              label="Session"
              direction={sort.direction('name')}
              onSort={() => sort.toggle('name')}
              className="bg-muted/50 text-muted-foreground border-border sticky left-0 z-10 border-r border-b px-3 py-2 text-left font-medium"
            />
            <MetricSortHeader
              bare
              colSpan={GRADES.length + 1}
              label="Girls' Availability"
              title="Sort by open spots"
              direction={sort.direction('girlsOpen')}
              onSort={() => sort.toggle('girlsOpen')}
              className="border-border border-r border-b bg-pink-50 px-2 py-2 text-center font-medium dark:bg-pink-950/30"
            />
            <th rowSpan={2} className="w-3 border-b" aria-hidden="true" />
            <MetricSortHeader
              bare
              colSpan={GRADES.length + 1}
              label="Boys' Availability"
              title="Sort by open spots"
              direction={sort.direction('boysOpen')}
              onSort={() => sort.toggle('boysOpen')}
              className="border-border border-b bg-blue-50 px-2 py-2 text-center font-medium dark:bg-blue-950/30"
            />
          </tr>
          <tr>
            {GRADES.map((g) => (
              <th
                key={`g-${g}`}
                className="text-muted-foreground border-border border-b bg-pink-50/50 px-2 py-2 text-center font-medium dark:bg-pink-950/20"
              >
                {gradeLabel(g)}
              </th>
            ))}
            <MetricSortHeader
              bare
              label="WL"
              title="Sort by waitlisted"
              direction={sort.direction('girlsWl')}
              onSort={() => sort.toggle('girlsWl')}
              className="text-muted-foreground border-border border-b bg-pink-50/50 px-2 py-2 text-center font-medium dark:bg-pink-950/20"
            />
            {GRADES.map((g) => (
              <th
                key={`b-${g}`}
                className="text-muted-foreground border-border border-b bg-blue-50/50 px-2 py-2 text-center font-medium dark:bg-blue-950/20"
              >
                {gradeLabel(g)}
              </th>
            ))}
            <MetricSortHeader
              bare
              label="WL"
              title="Sort by waitlisted"
              direction={sort.direction('boysWl')}
              onSort={() => sort.toggle('boysWl')}
              className="text-muted-foreground border-border border-b bg-blue-50/50 px-2 py-2 text-center font-medium dark:bg-blue-950/20"
            />
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.session_cm_id}>
              <td className="bg-muted/50 text-foreground border-border sticky left-0 z-10 border-r px-3 py-2 text-xs font-semibold whitespace-nowrap">
                {session.session_name}
              </td>
              <SessionRow session={session} gender="girls" {...handlers} />
              <td className="w-3" aria-hidden="true" />
              <SessionRow session={session} gender="boys" {...handlers} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SessionAvailability() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, activeSessionTypes, durationParam } =
    useMetricsSession()
  const { data, isLoading, error, refetch, isPlaceholderData } = useSessionAvailability(
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined,
    durationParam
  )

  const { camp: campSessions, quest: questSessions } = useMemo(
    () => splitCampAndQuest(data?.sessions ?? []),
    [data?.sessions]
  )

  const sort = useTableSort<AvailField>('name')
  const sortSessions = (list: SessionAvailabilityData[]) =>
    sort.apply(list, (session, field) => availSortValue(session, field))

  // Tooltip state
  const [tooltipData, setTooltipData] = useState<{
    totalCount: number
    genderLabel: string
    persons: WaitlistedPerson[]
    gradeSuffix: string | undefined
  } | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Drilldown
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['waitlisted'],
    sessionCmId: selectedSessionCmId ?? undefined,
    duration: durationParam,
  })

  // Tooltip handlers
  const handleHover = useCallback(
    (
      e: React.MouseEvent,
      totalCount: number,
      genderLabel: string,
      persons: WaitlistedPerson[],
      gradeSuffix?: string
    ) => {
      setTooltipData({ totalCount, genderLabel, persons, gradeSuffix })
      setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
    },
    []
  )

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!tooltipData) return
      setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
    },
    [tooltipData]
  )

  const handleLeave = useCallback(() => {
    setTooltipData(null)
  }, [])

  // Click any waitlist element (grade cell or WL pill) -> drilldown modal
  // grade is undefined when clicking the WL pill (shows all), or a number for grade cells
  const handleCellClick = useCallback(
    (
      sessionCmId: number,
      sessionName: string,
      genderCode: string,
      genderLabel: string,
      _totalCount: number,
      grade?: number
    ) => {
      setTooltipData(null)
      const gradeStr = grade != null ? `:${grade}` : ''
      const gradeSuffix = grade != null ? ` (${gradeLabel(grade)})` : ''
      const genderPrefix = genderLabel
        ? genderLabel.charAt(0).toUpperCase() + genderLabel.slice(1)
        : 'Campers'
      setFilter({
        type: 'waitlist_session_gender',
        value: `${sessionCmId}:${genderCode}${gradeStr}`,
        label: `${genderPrefix} Waitlisted — ${sessionName}${gradeSuffix}`,
        titleFormat: 'adjective',
        statusOverride: ['waitlisted'],
        waitlistContext: true,
      })
    },
    [setFilter]
  )

  // Teen rows aggregate under session_cm_id=0, so the drilldown is keyed on the
  // teen program type (scit/tli); the backend resolves it to real session ids.
  const handleTeenCellClick = useCallback(
    (teenType: string, sessionName: string, grade?: number) => {
      setTooltipData(null)
      const gradeStr = grade != null ? `:${grade}` : ''
      const gradeSuffix = grade != null ? ` (${gradeLabel(grade)})` : ''
      setFilter({
        type: 'waitlist_teen_program',
        value: `${teenType}${gradeStr}`,
        label: `Campers Waitlisted — ${sessionName}${gradeSuffix}`,
        titleFormat: 'adjective',
        statusOverride: ['waitlisted'],
        waitlistContext: true,
      })
    },
    [setFilter]
  )

  const waitlistHandlers: WaitlistHandlers = {
    onHover: handleHover,
    onMove: handleMove,
    onLeave: handleLeave,
    onCellClick: handleCellClick,
  }

  return (
    <MetricsQueryGuard
      onRetry={() => void refetch()}
      isPlaceholderData={isPlaceholderData}
      loadingLabel={String(currentYear)}
      isLoading={isLoading}
      error={error}
      data={data}
      label="availability"
      emptyMessage="No availability data for the selected filters"
    >
      {(guardedData) => {
        if (
          guardedData.sessions.length === 0 &&
          guardedData.ag_sessions.length === 0 &&
          guardedData.teen_sessions.length === 0
        ) {
          return (
            <div className="text-muted-foreground flex items-center justify-center py-12">
              No availability data for the selected filters
            </div>
          )
        }

        const { ag_sessions } = guardedData
        const teenSessions = guardedData.teen_sessions
        const shownCamp = sortSessions(campSessions)
        const shownQuest = sortSessions(questSessions)

        return (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-foreground text-lg font-semibold">Session Availability</h2>
                <p className="text-muted-foreground text-sm">
                  Grade-level availability by session and gender for {currentYear}
                </p>
              </div>
              <TableExportButtons
                filename={csvFilename(currentYear, 'Session Availability')}
                headers={AVAIL_HEADERS}
                rows={availabilityRows(
                  [
                    { label: 'Sessions', sessions: shownCamp },
                    { label: 'Quests', sessions: shownQuest },
                  ],
                  ag_sessions,
                  teenSessions
                )}
              />
            </div>

            <div className="card-lodge p-4" data-tour="reg-availability-heatmap">
              <div className="space-y-6">
                {/* Camp sessions matrix (main + embedded) */}
                {campSessions.length > 0 && (
                  <SessionsTable sessions={shownCamp} handlers={waitlistHandlers} sort={sort} />
                )}

                {/* AG Sessions + Teen Programs share one row: AG is the wide
                    2/3 column, the teen box slides into the narrow 1/3 column.
                    Either may be absent depending on the selected scope. */}
                {(ag_sessions.length > 0 || teenSessions.length > 0) && (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    {/* AG Sessions */}
                    {ag_sessions.length > 0 && (
                      <div
                        data-section="ag"
                        className={teenSessions.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}
                      >
                        <h4 className="text-muted-foreground mb-3 text-sm font-semibold">
                          AG Sessions
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full border-separate border-spacing-0 text-xs">
                            <thead>
                              <tr>
                                <th className="bg-muted/50 text-muted-foreground border-border sticky left-0 z-10 border-r border-b px-3 py-2 text-left font-medium">
                                  Session
                                </th>
                                {GRADES.map((g) => (
                                  <th
                                    key={g}
                                    className="text-muted-foreground border-border border-b bg-purple-50/50 px-2 py-2 text-center font-medium dark:bg-purple-950/20"
                                  >
                                    {gradeLabel(g)}
                                  </th>
                                ))}
                                <th className="text-muted-foreground border-border border-b bg-purple-50/50 px-2 py-2 text-center font-medium dark:bg-purple-950/20">
                                  WL
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {ag_sessions.map((session) => (
                                <tr key={session.session_cm_id}>
                                  <td className="bg-muted/50 text-foreground border-border sticky left-0 z-10 border-r px-3 py-2 text-xs font-semibold whitespace-nowrap">
                                    {sessionName(session.session_name, undefined, 'matrix')}
                                  </td>
                                  <AGSessionRow session={session} {...waitlistHandlers} />
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Teen Programs (SCIT / TLI) — 11th & 12th grade only */}
                    {teenSessions.length > 0 && (
                      <div
                        data-section="teen"
                        className={ag_sessions.length > 0 ? 'lg:col-span-1' : 'lg:col-span-3'}
                      >
                        <h4 className="text-muted-foreground mb-3 text-sm font-semibold">
                          Teen Programs
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full border-separate border-spacing-0 text-xs">
                            <thead>
                              <tr>
                                <th className="bg-muted/50 text-muted-foreground border-border sticky left-0 z-10 border-r border-b px-3 py-2 text-left font-medium">
                                  Session
                                </th>
                                {TEEN_GRADES.map((g) => (
                                  <th
                                    key={g}
                                    className="text-muted-foreground border-border border-b bg-teal-50/50 px-2 py-2 text-center font-medium dark:bg-teal-950/20"
                                  >
                                    {gradeLabel(g)}
                                  </th>
                                ))}
                                <th className="text-muted-foreground border-border border-b bg-teal-50/50 px-2 py-2 text-center font-medium dark:bg-teal-950/20">
                                  WL
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {teenSessions.map((session) => (
                                <tr key={`${session.session_type}-${session.session_cm_id}`}>
                                  <td className="bg-muted/50 text-foreground border-border sticky left-0 z-10 border-r px-3 py-2 text-xs font-semibold whitespace-nowrap">
                                    {session.session_name}
                                  </td>
                                  <TeenSessionRow
                                    session={session}
                                    {...waitlistHandlers}
                                    onTeenCellClick={handleTeenCellClick}
                                  />
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Quest sessions */}
                {questSessions.length > 0 && (
                  <div>
                    <h4 className="text-muted-foreground mb-3 text-sm font-semibold">Quests</h4>
                    <SessionsTable sessions={shownQuest} handlers={waitlistHandlers} sort={sort} />
                  </div>
                )}
              </div>

              <Legend />
            </div>

            <WaitlistTooltip
              isVisible={tooltipData !== null}
              position={tooltipPos}
              totalCount={tooltipData?.totalCount ?? 0}
              genderLabel={tooltipData?.genderLabel ?? ''}
              persons={tooltipData?.persons ?? []}
              gradeSuffix={tooltipData?.gradeSuffix}
            />

            <DrilldownModal />
          </div>
        )
      }}
    </MetricsQueryGuard>
  )
}
