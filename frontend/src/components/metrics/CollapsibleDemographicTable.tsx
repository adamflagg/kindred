/**
 * CollapsibleDemographicTable - Generic collapsible table for demographic breakdowns.
 *
 * Supports two variants:
 * - registration: Name, Count, % columns
 * - retention: Name, BaseYear, Returned, Retention columns with color-coded rates
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export interface RegistrationTableData {
  name: string
  count: number
  percentage: number
}

export interface RetentionTableData {
  name: string
  base_count: number
  returned_count: number
  retention_rate: number
}

interface BaseProps {
  title: string
  icon: React.ReactNode
  nameColumn: string
  defaultOpen?: boolean
  emptyMessage?: string
}

interface RegistrationProps extends BaseProps {
  variant: 'registration'
  data: RegistrationTableData[]
  baseYear?: never
}

interface RetentionProps extends BaseProps {
  variant: 'retention'
  data: RetentionTableData[]
  baseYear: number
}

export type CollapsibleDemographicTableProps = RegistrationProps | RetentionProps

// ============================================================================
// Helper Components
// ============================================================================

function EmptyState({ message }: { message: string }) {
  return <div className="text-muted-foreground px-4 py-8 text-center text-sm">{message}</div>
}

function RetentionRateCell({ rate }: { rate: number }) {
  const percentage = rate * 100
  const colorClass =
    percentage >= 60
      ? 'text-emerald-600 dark:text-emerald-400'
      : percentage >= 40
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  return <span className={colorClass}>{percentage.toFixed(1)}%</span>
}

// ============================================================================
// Main Component
// ============================================================================

export function CollapsibleDemographicTable(props: CollapsibleDemographicTableProps) {
  const {
    title,
    icon,
    nameColumn,
    defaultOpen = false,
    emptyMessage = 'No data available',
    variant,
    data,
  } = props

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
          <span className="text-muted-foreground text-sm">({data.length})</span>
        </div>
        {isOpen ? (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        )}
      </button>

      {isOpen && (
        <div className="border-border border-t">
          {data.length === 0 ? (
            <EmptyState message={emptyMessage} />
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-muted-foreground px-4 py-2 text-left font-medium">
                      {nameColumn}
                    </th>
                    {variant === 'registration' ? (
                      <>
                        <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                          Count
                        </th>
                        <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                          %
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                          {props.baseYear}
                        </th>
                        <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                          Returned
                        </th>
                        <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                          Retention
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {variant === 'registration'
                    ? (data as RegistrationTableData[]).map((item, idx) => (
                        <tr key={idx} className="border-border hover:bg-muted/30 border-t">
                          <td
                            className="text-foreground max-w-[200px] truncate px-4 py-2"
                            title={item.name}
                          >
                            {item.name}
                          </td>
                          <td className="text-foreground px-4 py-2 text-right">{item.count}</td>
                          <td className="text-muted-foreground px-4 py-2 text-right">
                            {item.percentage.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    : (data as RetentionTableData[]).map((item, idx) => (
                        <tr key={idx} className="border-border hover:bg-muted/30 border-t">
                          <td
                            className="text-foreground max-w-[200px] truncate px-4 py-2"
                            title={item.name}
                          >
                            {item.name}
                          </td>
                          <td className="text-foreground px-4 py-2 text-right">
                            {item.base_count}
                          </td>
                          <td className="text-foreground px-4 py-2 text-right">
                            {item.returned_count}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <RetentionRateCell rate={item.retention_rate} />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
