import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import {
  useSessionAvailability,
  type SessionAvailabilityData,
  type AGSessionAvailabilityData,
} from '../../../hooks/useSessionAvailability'
import { splitCampAndQuest } from '../../../utils/sessionUtils'

const GRADES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

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

function CellContent({ status }: { status: Status }) {
  switch (status) {
    case 'open':
      return <span className="sr-only">Open</span>
    case 'limited':
      return <span className="sr-only">Limited</span>
    case 'full':
      return <span className="sr-only">Full</span>
    case 'na':
      return <span className="sr-only">N/A</span>
  }
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

function SessionRow({
  session,
  gender,
}: {
  session: SessionAvailabilityData
  gender: 'girls' | 'boys'
}) {
  const genderData = session[gender]
  const hasWaitlist = genderData.waitlisted > 0

  return (
    <>
      {GRADES.map((grade) => {
        const status = statusForGrade(genderData, grade)
        const wlCount = genderData.waitlisted_by_grade[grade] ?? 0
        return (
          <td key={grade} className={cellClass(status)}>
            {wlCount > 0 ? (
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
                {wlCount}
              </span>
            ) : (
              <CellContent status={status} />
            )}
          </td>
        )
      })}
      {/* WL pill column */}
      <td className="border-border/50 min-w-[2.5rem] border px-2 py-2 text-center">
        {hasWaitlist ? (
          <span className="inline-flex items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            {genderData.waitlisted}
          </span>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
    </>
  )
}

function AGSessionRow({ session }: { session: AGSessionAvailabilityData }) {
  const hasWaitlist = session.waitlisted > 0

  return (
    <>
      {GRADES.map((grade) => {
        const status = statusForGrade(
          { min_grade: session.min_grade, max_grade: session.max_grade, status: session.status },
          grade
        )
        const wlCount = session.waitlisted_by_grade[grade] ?? 0
        return (
          <td key={grade} className={cellClass(status)}>
            {wlCount > 0 ? (
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
                {wlCount}
              </span>
            ) : (
              <CellContent status={status} />
            )}
          </td>
        )
      })}
      {/* WL pill column */}
      <td className="border-border/50 min-w-[2.5rem] border px-2 py-2 text-center">
        {hasWaitlist ? (
          <span className="inline-flex items-center justify-center rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            {session.waitlisted}
          </span>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
    </>
  )
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
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

function SessionsTable({ sessions }: { sessions: SessionAvailabilityData[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="bg-muted/50 text-muted-foreground border-border sticky left-0 z-10 border-r border-b px-3 py-2 text-left font-medium"
            >
              Session
            </th>
            <th
              colSpan={GRADES.length + 1}
              className="border-border border-r border-b bg-pink-50 px-2 py-2 text-center font-medium dark:bg-pink-950/30"
            >
              Girls' Availability
            </th>
            <th rowSpan={2} className="w-3 border-b" aria-hidden="true" />
            <th
              colSpan={GRADES.length + 1}
              className="border-border border-b bg-blue-50 px-2 py-2 text-center font-medium dark:bg-blue-950/30"
            >
              Boys' Availability
            </th>
          </tr>
          <tr>
            {GRADES.map((g) => (
              <th
                key={`g-${g}`}
                className="text-muted-foreground border-border border-r border-b bg-pink-50/50 px-2 py-2 text-center font-medium dark:bg-pink-950/20"
              >
                {gradeLabel(g)}
              </th>
            ))}
            <th className="text-muted-foreground border-border border-r border-b bg-pink-50/50 px-2 py-2 text-center font-medium dark:bg-pink-950/20">
              WL
            </th>
            {GRADES.map((g) => (
              <th
                key={`b-${g}`}
                className="text-muted-foreground border-border border-b bg-blue-50/50 px-2 py-2 text-center font-medium dark:bg-blue-950/20"
              >
                {gradeLabel(g)}
              </th>
            ))}
            <th className="text-muted-foreground border-border border-b bg-blue-50/50 px-2 py-2 text-center font-medium dark:bg-blue-950/20">
              WL
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.session_cm_id}>
              <td className="bg-muted/50 text-foreground border-border sticky left-0 z-10 border-r px-3 py-2 text-xs font-semibold whitespace-nowrap">
                {session.session_name}
              </td>
              <SessionRow session={session} gender="girls" />
              <td className="w-3" aria-hidden="true" />
              <SessionRow session={session} gender="boys" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SessionAvailability() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, durationParam } = useMetricsSession()
  const { data, isLoading, error } = useSessionAvailability(
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined,
    durationParam
  )

  const { camp: campSessions, quest: questSessions } = useMemo(
    () => splitCampAndQuest(data?.sessions ?? []),
    [data?.sessions]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading availability data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load availability data</p>
      </div>
    )
  }

  if (!data) return null

  if (data.sessions.length === 0 && data.ag_sessions.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No availability data for the selected filters
      </div>
    )
  }

  const { ag_sessions } = data

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">Session Availability</h2>
        <p className="text-muted-foreground text-sm">
          Grade-level availability by session and gender for {currentYear}
        </p>
      </div>

      <div className="card-lodge p-4">
        <div className="space-y-6">
          {/* Camp sessions matrix (main + embedded) */}
          {campSessions.length > 0 && <SessionsTable sessions={campSessions} />}

          {/* AG Sessions */}
          {ag_sessions.length > 0 && (
            <div>
              <h4 className="text-muted-foreground mb-3 text-sm font-semibold">AG Sessions</h4>
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
                          {session.session_name}
                        </td>
                        <AGSessionRow session={session} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Quest sessions */}
          {questSessions.length > 0 && (
            <div>
              <h4 className="text-muted-foreground mb-3 text-sm font-semibold">Quests</h4>
              <SessionsTable sessions={questSessions} />
            </div>
          )}
        </div>

        <Legend />
      </div>
    </div>
  )
}
