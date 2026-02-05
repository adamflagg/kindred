/**
 * RetentionDemographicBreakdowns - Collapsible tables for retention by demographics.
 *
 * Refactored to use CollapsibleDemographicTable for standard 4-column retention tables.
 * Session+Bunk table kept as custom due to unique 2-name-column structure.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Building2, MapPin, Heart, Calendar, Home } from 'lucide-react'
import { CollapsibleDemographicTable, type RetentionTableData } from './CollapsibleDemographicTable'
import type {
  RetentionBySchool,
  RetentionByCity,
  RetentionBySynagogue,
  RetentionByFirstYear,
  RetentionBySessionBunk,
} from '../../types/metrics'

interface RetentionDemographicBreakdownsProps {
  bySchool: RetentionBySchool[] | undefined
  byCity: RetentionByCity[] | undefined
  bySynagogue: RetentionBySynagogue[] | undefined
  byFirstYear: RetentionByFirstYear[] | undefined
  bySessionBunk: RetentionBySessionBunk[] | undefined
  baseYear: number
}

// Transform functions to convert API types to table data
function transformSchoolData(data: RetentionBySchool[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.school,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }))
}

function transformCityData(data: RetentionByCity[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.city,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }))
}

function transformSynagogueData(data: RetentionBySynagogue[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.synagogue,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }))
}

function transformFirstYearData(data: RetentionByFirstYear[]): RetentionTableData[] {
  return data.map((item) => ({
    name: String(item.first_year),
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }))
}

// Helper component for retention rate display in Session+Bunk table
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

export function RetentionDemographicBreakdowns({
  bySchool = [],
  byCity = [],
  bySynagogue = [],
  byFirstYear = [],
  bySessionBunk = [],
  baseYear,
}: RetentionDemographicBreakdownsProps) {
  return (
    <div className="space-y-4">
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 className="text-muted-foreground h-4 w-4" />}
        data={transformSchoolData(bySchool)}
        variant="retention"
        nameColumn="School"
        baseYear={baseYear}
        emptyMessage="No school data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by City"
        icon={<MapPin className="text-muted-foreground h-4 w-4" />}
        data={transformCityData(byCity)}
        variant="retention"
        nameColumn="City"
        baseYear={baseYear}
        emptyMessage="No city data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by Synagogue"
        icon={<Heart className="text-muted-foreground h-4 w-4" />}
        data={transformSynagogueData(bySynagogue)}
        variant="retention"
        nameColumn="Synagogue"
        baseYear={baseYear}
        emptyMessage="No synagogue data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by First Year Attended"
        icon={<Calendar className="text-muted-foreground h-4 w-4" />}
        data={transformFirstYearData(byFirstYear)}
        variant="retention"
        nameColumn="First Year"
        baseYear={baseYear}
        defaultOpen
        emptyMessage="No first year data available. Run camper-history sync to populate."
      />

      {/* Session+Bunk has 2 name columns, keeping custom table */}
      {bySessionBunk.length > 0 && (
        <CollapsibleTable
          title="Retention by Session + Bunk"
          icon={<Home className="text-muted-foreground h-4 w-4" />}
          count={bySessionBunk.length}
        >
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-muted-foreground px-4 py-2 text-left font-medium">Session</th>
                  <th className="text-muted-foreground px-4 py-2 text-left font-medium">Bunk</th>
                  <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                    {baseYear}
                  </th>
                  <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                    Returned
                  </th>
                  <th className="text-muted-foreground px-4 py-2 text-right font-medium">
                    Retention
                  </th>
                </tr>
              </thead>
              <tbody>
                {bySessionBunk.map((item, idx) => (
                  <tr key={idx} className="border-border hover:bg-muted/30 border-t">
                    <td className="text-foreground px-4 py-2">{item.session}</td>
                    <td className="text-foreground px-4 py-2">{item.bunk}</td>
                    <td className="text-foreground px-4 py-2 text-right">{item.base_count}</td>
                    <td className="text-foreground px-4 py-2 text-right">{item.returned_count}</td>
                    <td className="px-4 py-2 text-right">
                      <RetentionRateCell rate={item.retention_rate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      )}
    </div>
  )
}
