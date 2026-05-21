/**
 * DemographicTable - Searchable, sortable table for demographic breakdowns
 *
 * Displays full lists of school/city/synagogue data with retention stats.
 * Enables data quality visibility by showing ALL values, not just top-N.
 */

import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, Download } from 'lucide-react'
import { SortIcon } from './SortIcon'

export interface DemographicRow {
  name: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface DemographicTableProps {
  /** Title for the table (e.g., "School", "City", "Synagogue") */
  title: string
  /** Data rows to display */
  data: DemographicRow[]
  /** Callback when a row is clicked (for cohort export) */
  onRowClick?: (name: string) => void
}

type SortField = 'name' | 'base_count' | 'retention_rate'
type SortDirection = 'asc' | 'desc'

export function DemographicTable({ title, data, onRowClick }: DemographicTableProps) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('base_count')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Filter and sort data
  const filteredData = useMemo(() => {
    let result = data

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter((row) => row.name.toLowerCase().includes(searchLower))
    }

    // Apply sorting
    result = result.toSorted((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'base_count':
          comparison = a.base_count - b.base_count
          break
        case 'retention_rate':
          comparison = a.retention_rate - b.retention_rate
          break
      }
      return sortDirection === 'desc' ? -comparison : comparison
    })

    return result
  }, [data, search, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Export to CSV
  const handleExport = () => {
    const headers = ['Name', 'Base Count', 'Returned', 'Retention Rate']
    const rows = filteredData.map((row) => [
      row.name,
      row.base_count,
      row.returned_count,
      `${(row.retention_rate * 100).toFixed(1)}%`,
    ])

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.toLowerCase()}_retention.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input w-40 py-1.5 pl-8 text-sm"
            />
          </div>
          <button onClick={handleExport} className="btn-ghost p-1.5" title="Export to CSV">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-background sticky top-0">
            <tr className="border-border border-b">
              <th
                className="hover:bg-muted/50 cursor-pointer px-2 py-2 text-left"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  {title}
                  <SortIcon
                    field="name"
                    activeField={sortField}
                    direction={sortDirection}
                    ascIcon={ChevronUp}
                    descIcon={ChevronDown}
                    className="h-4 w-4"
                  />
                </div>
              </th>
              <th
                className="hover:bg-muted/50 cursor-pointer px-2 py-2 text-right"
                onClick={() => handleSort('base_count')}
              >
                <div className="flex items-center justify-end gap-1">
                  Count
                  <SortIcon
                    field="base_count"
                    activeField={sortField}
                    direction={sortDirection}
                    ascIcon={ChevronUp}
                    descIcon={ChevronDown}
                    className="h-4 w-4"
                  />
                </div>
              </th>
              <th className="px-2 py-2 text-right">Returned</th>
              <th
                className="hover:bg-muted/50 cursor-pointer px-2 py-2 text-right"
                onClick={() => handleSort('retention_rate')}
              >
                <div className="flex items-center justify-end gap-1">
                  Rate
                  <SortIcon
                    field="retention_rate"
                    activeField={sortField}
                    direction={sortDirection}
                    ascIcon={ChevronUp}
                    descIcon={ChevronDown}
                    className="h-4 w-4"
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground py-4 text-center">
                  {search ? 'No matching results' : 'No data available'}
                </td>
              </tr>
            ) : (
              filteredData.map((row) => (
                <tr
                  key={row.name}
                  className={`border-border border-b last:border-0 ${onRowClick ? 'hover:bg-muted/30 cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row.name)}
                >
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2 text-right">{row.base_count}</td>
                  <td className="px-2 py-2 text-right">{row.returned_count}</td>
                  <td className="px-2 py-2 text-right">
                    <span
                      className={
                        row.retention_rate >= 0.7
                          ? 'text-green-600 dark:text-green-400'
                          : row.retention_rate >= 0.5
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {(row.retention_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.length > 0 && (
        <div className="text-muted-foreground mt-2 text-xs">
          Showing {filteredData.length} of {data.length} entries
        </div>
      )}
    </div>
  )
}
