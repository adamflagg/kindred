import type { ReactNode } from 'react'
import type { VelocityCurve, PriorYearSessionSummary } from '../../types/velocity'
import { resolveSessionAlias } from '../../utils/sessionAliases'

export interface SessionColumnDef {
  header: string
  accessor: (session: VelocityCurve, priorData?: PriorYearSessionSummary) => ReactNode
  className?: string
}

interface SessionBreakdownTableProps {
  sortedBySession: VelocityCurve[]
  priorSessionMap: Map<string, PriorYearSessionSummary>
  selectedPriorYears: number[]
  splitByGender: boolean
  columns: SessionColumnDef[]
}

export function SessionBreakdownTable({
  sortedBySession,
  priorSessionMap,
  columns,
}: SessionBreakdownTableProps) {
  if (sortedBySession.length === 0) {
    return (
      <div className="card-lodge p-4">
        <p className="text-muted-foreground text-sm">No session data available</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-muted/30 border-b">
            {columns.map((col) => (
              <th
                key={col.header}
                className={`text-muted-foreground px-4 py-3 font-medium ${col.className ?? 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedBySession.map((session) => {
            const canonical = session.session_name
              ? resolveSessionAlias(session.session_name)
              : null
            const priorSession = canonical ? priorSessionMap.get(canonical) : undefined

            return (
              <tr
                key={session.session_cm_id}
                className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
              >
                {columns.map((col) => (
                  <td key={col.header} className={`px-4 py-3 ${col.className ?? ''}`}>
                    {col.accessor(session, priorSession)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
