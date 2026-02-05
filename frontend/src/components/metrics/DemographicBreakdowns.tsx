/**
 * DemographicBreakdowns - Session+Bunk combination table.
 *
 * Note: School, city, synagogue, and first year breakdowns have been moved
 * to the Geographic Analysis tab (/metrics/registration/geo).
 * This component now only shows the session+bunk combinations table.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Building2 } from 'lucide-react'
import type { SessionBunkBreakdown } from '../../types/metrics'

interface DemographicBreakdownsProps {
  bySessionBunk: SessionBunkBreakdown[] | undefined
}

// Custom CollapsibleTable for Session+Bunk (has 2 name columns)
interface CollapsibleTableProps {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  count?: number
}

function CollapsibleTable({
  title,
  icon,
  defaultOpen = false,
  children,
  count,
}: CollapsibleTableProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="card-lodge overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="hover:bg-muted/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-foreground font-medium">{title}</span>
          {count !== undefined && <span className="text-muted-foreground text-sm">({count})</span>}
        </div>
        {isOpen ? (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        )}
      </button>
      {isOpen && <div className="border-border border-t">{children}</div>}
    </div>
  )
}

export function DemographicBreakdowns({ bySessionBunk = [] }: DemographicBreakdownsProps) {
  if (bySessionBunk.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <CollapsibleTable
        title="Top Session + Bunk Combinations"
        icon={<Building2 className="text-muted-foreground h-4 w-4" />}
        count={bySessionBunk.length}
      >
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-muted-foreground px-4 py-2 text-left font-medium">Session</th>
                <th className="text-muted-foreground px-4 py-2 text-left font-medium">Bunk</th>
                <th className="text-muted-foreground px-4 py-2 text-right font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {bySessionBunk.map((item, idx) => (
                <tr key={idx} className="border-border hover:bg-muted/30 border-t">
                  <td className="text-foreground px-4 py-2">{item.session}</td>
                  <td className="text-foreground px-4 py-2">{item.bunk}</td>
                  <td className="text-foreground px-4 py-2 text-right">{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
    </div>
  )
}
