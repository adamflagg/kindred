/**
 * DrillDownModal - Modal displaying attendees matching a chart segment.
 *
 * Features:
 * - Header with count and filter description
 * - Search input to filter displayed results
 * - Sortable columns
 * - CSV export
 */

import { useState, useMemo, useEffect } from 'react'
import { X, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { useDrilldownAttendees } from '../../hooks/useDrilldownAttendees'
import type { DrilldownFilter } from '../../types/metrics'

interface DrillDownModalProps {
  year: number
  filter: DrilldownFilter | null
  sessionCmId?: number | undefined
  sessionTypes?: string[] | undefined
  statusFilter?: string[] | undefined
  onClose: () => void
}

type SortField = 'name' | 'grade' | 'gender' | 'school' | 'city' | 'session' | 'years'
type SortDirection = 'asc' | 'desc'

export function DrillDownModal({
  year,
  filter,
  sessionCmId,
  sessionTypes,
  statusFilter,
  onClose,
}: DrillDownModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const {
    data: attendees = [],
    isLoading,
    error,
  } = useDrilldownAttendees({
    year,
    filter,
    sessionCmId,
    sessionTypes,
    statusFilter,
  })

  // Handle escape key to close modal
  useEffect(() => {
    if (!filter) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [filter, onClose])

  // Filter attendees by search term
  const filteredAttendees = useMemo(() => {
    if (!searchTerm.trim()) {
      return attendees
    }
    const term = searchTerm.toLowerCase()
    return attendees.filter(
      (a) =>
        a.first_name.toLowerCase().includes(term) ||
        a.last_name.toLowerCase().includes(term) ||
        (a.preferred_name?.toLowerCase().includes(term) ?? false) ||
        (a.school?.toLowerCase().includes(term) ?? false) ||
        (a.city?.toLowerCase().includes(term) ?? false) ||
        (a.state?.toLowerCase().includes(term) ?? false) ||
        a.session_name.toLowerCase().includes(term)
    )
  }, [attendees, searchTerm])

  // Sort attendees
  const sortedAttendees = useMemo(() => {
    const sorted = [...filteredAttendees]
    sorted.sort((a, b) => {
      let aVal: string | number | null | undefined
      let bVal: string | number | null | undefined

      switch (sortField) {
        case 'name':
          aVal = `${a.last_name} ${a.first_name}`.toLowerCase()
          bVal = `${b.last_name} ${b.first_name}`.toLowerCase()
          break
        case 'grade':
          aVal = a.grade ?? -1
          bVal = b.grade ?? -1
          break
        case 'gender':
          aVal = a.gender ?? ''
          bVal = b.gender ?? ''
          break
        case 'school':
          aVal = a.school?.toLowerCase() ?? ''
          bVal = b.school?.toLowerCase() ?? ''
          break
        case 'city':
          aVal = a.city?.toLowerCase() ?? ''
          bVal = b.city?.toLowerCase() ?? ''
          break
        case 'session':
          aVal = a.session_name.toLowerCase()
          bVal = b.session_name.toLowerCase()
          break
        case 'years':
          aVal = a.years_at_camp ?? 0
          bVal = b.years_at_camp ?? 0
          break
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [filteredAttendees, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const downloadCsv = () => {
    const headers = [
      'Name',
      'Grade',
      'Gender',
      'Age',
      'School',
      'City',
      'State',
      'Session',
      'Years at Camp',
      'Status',
      'Returning',
    ]

    const rows = sortedAttendees.map((a) => [
      a.preferred_name || `${a.first_name} ${a.last_name}`,
      a.grade ?? '',
      a.gender ?? '',
      a.age ?? '',
      a.school ?? '',
      a.city ?? '',
      a.state ?? '',
      a.session_name,
      a.years_at_camp ?? '',
      a.status,
      a.is_returning ? 'Yes' : 'No',
    ])

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filter?.label.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    )
  }

  if (!filter) return null

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-card border-border flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg border shadow-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">
              {sortedAttendees.length} camper
              {sortedAttendees.length !== 1 ? 's' : ''} in {filter.label}
            </h2>
            <p className="text-muted-foreground text-sm">
              {year} enrollment data
              {searchTerm && ` (filtered from ${attendees.length})`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCsv}
              disabled={sortedAttendees.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-border border-b px-6 py-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, school, city, session..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-background border-input focus:ring-ring w-full rounded-md border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-primary h-6 w-6 animate-spin" />
              <span className="text-muted-foreground ml-2">Loading campers...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load data: {error.message}
            </div>
          ) : sortedAttendees.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center py-12">
              {searchTerm ? 'No campers match your search' : 'No campers found'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/80 sticky top-0 backdrop-blur">
                <tr>
                  <th
                    onClick={() => handleSort('name')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left font-medium"
                  >
                    <div className="flex items-center gap-1">
                      Name <SortIcon field="name" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('grade')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center font-medium"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Grade <SortIcon field="grade" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('gender')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center font-medium"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Gender <SortIcon field="gender" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('school')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left font-medium"
                  >
                    <div className="flex items-center gap-1">
                      School <SortIcon field="school" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('city')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left font-medium"
                  >
                    <div className="flex items-center gap-1">
                      City <SortIcon field="city" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('session')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-left font-medium"
                  >
                    <div className="flex items-center gap-1">
                      Session <SortIcon field="session" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('years')}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-4 py-3 text-center font-medium"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Years <SortIcon field="years" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAttendees.map((attendee, index) => (
                  <tr
                    key={`${attendee.person_id}-${attendee.session_cm_id}-${index}`}
                    className="border-border hover:bg-muted/30 border-b transition-colors last:border-0"
                  >
                    <td className="text-foreground px-4 py-3 font-medium">
                      {attendee.preferred_name || `${attendee.first_name} ${attendee.last_name}`}
                      {attendee.is_returning && (
                        <span className="bg-primary/10 text-primary ml-2 rounded px-1.5 py-0.5 text-xs">
                          Returning
                        </span>
                      )}
                    </td>
                    <td className="text-foreground px-4 py-3 text-center">
                      {attendee.grade ?? '—'}
                    </td>
                    <td className="text-foreground px-4 py-3 text-center">
                      {attendee.gender ?? '—'}
                    </td>
                    <td className="text-foreground px-4 py-3">{attendee.school ?? '—'}</td>
                    <td className="text-foreground px-4 py-3">
                      {attendee.city
                        ? attendee.state
                          ? `${attendee.city}, ${attendee.state}`
                          : attendee.city
                        : '—'}
                    </td>
                    <td className="text-foreground px-4 py-3">{attendee.session_name}</td>
                    <td className="text-foreground px-4 py-3 text-center">
                      {attendee.years_at_camp ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
