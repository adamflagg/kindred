import { Loader2 } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import {
  useSessionAvailability,
  type SessionAvailabilityData,
  type AGSessionAvailabilityData,
} from '../../../hooks/useSessionAvailability'

const GRADES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

function gradeLabel(grade: number): string {
  if (grade === 2) return '2nd'
  if (grade === 3) return '3rd'
  return `${grade}th`
}

type Status = 'open' | 'limited' | 'waitlist' | 'na'

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
    case 'waitlist':
      return <span className="text-xs font-bold">WL</span>
    case 'na':
      return <span className="sr-only">N/A</span>
  }
}

function cellClass(status: Status): string {
  const base = 'h-8 w-8 border border-border/50'
  switch (status) {
    case 'open':
      return `${base} bg-emerald-100 dark:bg-emerald-900/40`
    case 'limited':
      return `${base} bg-amber-200 dark:bg-amber-800/50`
    case 'waitlist':
      return `${base} bg-red-200 dark:bg-red-900/50 flex items-center justify-center`
    case 'na':
      return `${base} bg-neutral-800 dark:bg-neutral-900`
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
  return (
    <>
      {GRADES.map((grade) => {
        const status = statusForGrade(genderData, grade)
        return (
          <td key={grade} className="p-0">
            <div className={cellClass(status)}>
              <CellContent status={status} />
            </div>
          </td>
        )
      })}
    </>
  )
}

function AGSessionRow({ session }: { session: AGSessionAvailabilityData }) {
  return (
    <>
      {GRADES.map((grade) => {
        const status = statusForGrade(
          { min_grade: session.min_grade, max_grade: session.max_grade, status: session.status },
          grade
        )
        return (
          <td key={grade} className="p-0">
            <div className={cellClass(status)}>
              <CellContent status={status} />
            </div>
          </td>
        )
      })}
    </>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="border-border/50 h-5 w-5 rounded border bg-emerald-100 dark:bg-emerald-900/40" />
        <span>Open Space</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="border-border/50 h-5 w-5 rounded border bg-amber-200 dark:bg-amber-800/50" />
        <span>Limited Space</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="border-border/50 flex h-5 w-5 items-center justify-center rounded border bg-red-200 text-[10px] font-bold dark:bg-red-900/50">
          WL
        </div>
        <span>Waitlist</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="border-border/50 h-5 w-5 rounded border bg-neutral-800 dark:bg-neutral-900" />
        <span>N/A</span>
      </div>
    </div>
  )
}

export default function SessionAvailability() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam } = useMetricsSession()
  const { data, isLoading, error } = useSessionAvailability(
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
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

  const { sessions, ag_sessions } = data

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Session Availability</h2>
        <p className="text-muted-foreground text-sm">
          Grade-level availability by session and gender for {currentYear}
        </p>
      </div>

      <Legend />

      {/* Main sessions matrix */}
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-auto border-collapse">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="bg-muted/50 border-border sticky left-0 z-10 border-r border-b px-4 py-2 text-left text-sm font-semibold"
              >
                Session
              </th>
              <th
                colSpan={GRADES.length}
                className="border-border border-r border-b bg-pink-50 px-2 py-1.5 text-center text-sm font-semibold dark:bg-pink-950/30"
              >
                Girls' Availability
              </th>
              <th
                colSpan={GRADES.length}
                className="border-border border-b bg-blue-50 px-2 py-1.5 text-center text-sm font-semibold dark:bg-blue-950/30"
              >
                Boys' Availability
              </th>
            </tr>
            <tr>
              {/* Girls grade headers */}
              {GRADES.map((g) => (
                <th
                  key={`g-${g}`}
                  className="border-border border-r border-b bg-pink-50/50 px-1 py-1 text-center text-xs font-medium dark:bg-pink-950/20"
                >
                  {gradeLabel(g)}
                </th>
              ))}
              {/* Boys grade headers */}
              {GRADES.map((g) => (
                <th
                  key={`b-${g}`}
                  className="border-border border-b bg-blue-50/50 px-1 py-1 text-center text-xs font-medium dark:bg-blue-950/20"
                >
                  {gradeLabel(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.session_cm_id} className="border-border border-b last:border-b-0">
                <td className="bg-card border-border sticky left-0 z-10 border-r px-4 py-2 text-sm font-medium whitespace-nowrap">
                  {session.session_name}
                </td>
                <SessionRow session={session} gender="girls" />
                <SessionRow session={session} gender="boys" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AG Sessions */}
      {ag_sessions.length > 0 && (
        <div>
          <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase">
            AG Sessions
          </h3>
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-auto border-collapse">
              <thead>
                <tr>
                  <th className="bg-muted/50 border-border sticky left-0 z-10 border-r border-b px-4 py-2 text-left text-sm font-semibold">
                    Session
                  </th>
                  {GRADES.map((g) => (
                    <th
                      key={g}
                      className="border-border border-b bg-purple-50/50 px-1 py-1 text-center text-xs font-medium dark:bg-purple-950/20"
                    >
                      {gradeLabel(g)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ag_sessions.map((session) => (
                  <tr
                    key={session.session_cm_id}
                    className="border-border border-b last:border-b-0"
                  >
                    <td className="bg-card border-border sticky left-0 z-10 border-r px-4 py-2 text-sm font-medium whitespace-nowrap">
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
    </div>
  )
}
