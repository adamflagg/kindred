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
import { Link } from 'react-router'
import { X, Download, Search, ArrowUpDown, Loader2 } from 'lucide-react'
import { SortIcon } from './SortIcon'
import {
  SortableColumnHeader,
  type SortDirection as HeaderSortDirection,
} from '../ui/SortableColumnHeader'
import { useDrilldownAttendees } from '../../hooks/useDrilldownAttendees'
import { shortenSessionName } from '../../utils/sessionDisplay'
import { buildCsvContent, downloadCsv as triggerCsvDownload } from '../../utils/csvExport'
import type { DrilldownAttendee, DrilldownFilter } from '../../types/metrics'

/** Get display session name: comma-joined if multi-session, fallback to single session_name. */
function getSessionDisplay(a: DrilldownAttendee): string {
  if (a.sessions && a.sessions.length > 0) {
    return a.sessions.map((s) => shortenSessionName(s.session_name)).join(', ')
  }
  return shortenSessionName(a.session_name)
}

/** Get enrolled sessions display: comma-joined or "—" if empty. */
function getEnrolledDisplay(a: DrilldownAttendee): string {
  if (a.enrolled_sessions && a.enrolled_sessions.length > 0) {
    return a.enrolled_sessions.map((s) => shortenSessionName(s.session_name)).join(', ')
  }
  return '—'
}

/** Format a date string as short locale date (e.g. "Nov 10, 2025"). */
function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Get the best registration date: effective_date if available, fallback to enrollment_date. */
function getRegistrationDate(a: DrilldownAttendee): string | undefined {
  return a.effective_date ?? a.enrollment_date
}

interface DrillDownModalProps {
  year: number
  filter: DrilldownFilter | null
  sessionCmId?: number | undefined
  sessionTypes?: string[] | undefined
  statusFilter?: string[] | undefined
  duration?: string | undefined
  onClose: () => void
}

type SortField =
  | 'name'
  | 'grade'
  | 'gender'
  | 'school'
  | 'city'
  | 'session'
  | 'years'
  | 'enrolled'
  | 'enrolled_current'
  | 'registration'
  | 'cancelled'
type SortDirection = 'asc' | 'desc'

export function DrillDownModal({
  year,
  filter,
  sessionCmId,
  sessionTypes,
  statusFilter,
  duration,
  onClose,
}: DrillDownModalProps) {
  const isWaitlistDrilldown =
    filter?.type.startsWith('waitlist_') ?? filter?.waitlistContext ?? false

  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>(
    isWaitlistDrilldown ? 'registration' : 'name'
  )
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const isRetentionDrilldown = !!filter?.retentionContext
  const isCancellationDrilldown = filter?.type.startsWith('cancellation_') ?? false
  // These cancellation types use default layout (School + Session columns)
  const isCancellationDefaultLayout =
    filter?.type === 'cancellation_no_other_sessions' || filter?.type === 'cancellation_re_enrolled'
  // Show special cancellation columns (Cancelled Session + Current Session)
  const isCancellationSpecial = isCancellationDrilldown && !isCancellationDefaultLayout

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
    duration,
  })

  // Handle escape key to close modal.
  //
  // CORRECT AS-IS, no overlay token (kindred#2237): it renders no overlay of
  // its own, and its single mount site (`hooks/useDrilldown.tsx`, on the
  // metrics pages) puts no other Escape-handling surface on screen with it.
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
        (!isWaitlistDrilldown &&
          !isRetentionDrilldown &&
          !isCancellationSpecial &&
          (a.school?.toLowerCase().includes(term) ?? false)) ||
        (a.city?.toLowerCase().includes(term) ?? false) ||
        (a.state?.toLowerCase().includes(term) ?? false) ||
        getSessionDisplay(a).toLowerCase().includes(term) ||
        (isWaitlistDrilldown && getEnrolledDisplay(a).toLowerCase().includes(term)) ||
        (isRetentionDrilldown && getEnrolledDisplay(a).toLowerCase().includes(term)) ||
        (isCancellationSpecial && getEnrolledDisplay(a).toLowerCase().includes(term))
    )
  }, [attendees, searchTerm, isWaitlistDrilldown, isRetentionDrilldown, isCancellationSpecial])

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
          aVal = getSessionDisplay(a).toLowerCase()
          bVal = getSessionDisplay(b).toLowerCase()
          break
        case 'years':
          aVal = a.years_at_camp ?? 0
          bVal = b.years_at_camp ?? 0
          break
        case 'enrolled':
          aVal = getEnrolledDisplay(a).toLowerCase()
          bVal = getEnrolledDisplay(b).toLowerCase()
          break
        case 'enrolled_current':
          aVal = getEnrolledDisplay(a).toLowerCase()
          bVal = getEnrolledDisplay(b).toLowerCase()
          break
        case 'registration':
          aVal = getRegistrationDate(a) ?? ''
          bVal = getRegistrationDate(b) ?? ''
          break
        case 'cancelled':
          aVal = a.enrollment_date ?? ''
          bVal = b.enrollment_date ?? ''
          break
      }

      // Nulls/empty last for date sorts
      if (sortField === 'registration' || sortField === 'cancelled') {
        if (!aVal && bVal) return 1
        if (aVal && !bVal) return -1
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

  const headerDirection = (field: SortField): HeaderSortDirection | null =>
    sortField === field ? (sortDirection === 'desc' ? 'descending' : 'ascending') : null

  /** Same faint ArrowUpDown-when-inactive treatment for every column — unlike
   *  the other two sites converted for #2068, this one shows a sort affordance
   *  even before a column is ever clicked. */
  const headerIndicator = (field: SortField) => (
    <SortIcon
      field={field}
      activeField={sortField}
      direction={sortDirection}
      inactiveIcon={ArrowUpDown}
      inactiveClassName="h-3 w-3 opacity-50"
    />
  )

  const downloadCsv = () => {
    const headers = isWaitlistDrilldown
      ? [
          'CampMinder ID',
          'Name',
          'Grade',
          'Gender',
          'Age',
          'School',
          'City',
          'State',
          'Waitlisted For',
          'Enrolled In',
          'Applied',
          'Years at Camp',
          'Status',
          'Returning',
        ]
      : isRetentionDrilldown
        ? [
            'CampMinder ID',
            'Name',
            'Grade',
            'Gender',
            'Age',
            'School',
            'City',
            'State',
            'Prior Session',
            'Session',
            'Years at Camp',
            'Status',
            'Returning',
          ]
        : isCancellationSpecial
          ? [
              'CampMinder ID',
              'Name',
              'Grade',
              'Gender',
              'Age',
              'School',
              'City',
              'State',
              'Cancelled Session',
              'Current Session',
              'Registered',
              'Cancelled',
              'Years at Camp',
              'Status',
              'Returning',
            ]
          : [
              'CampMinder ID',
              'Name',
              'Grade',
              'Gender',
              'Age',
              'School',
              'City',
              'State',
              'Session',
              'Registered',
              'Years at Camp',
              'Status',
              'Returning',
            ]

    const rows = sortedAttendees.map((a) =>
      isWaitlistDrilldown
        ? [
            a.person_id,
            `${a.preferred_name ?? a.first_name} ${a.last_name}`,
            a.grade ?? '',
            a.gender ?? '',
            a.age ?? '',
            a.school ?? '',
            a.city ?? '',
            a.state ?? '',
            getSessionDisplay(a),
            getEnrolledDisplay(a),
            formatDate(getRegistrationDate(a)),
            a.years_at_camp ?? '',
            a.status,
            a.is_returning ? 'Yes' : 'No',
          ]
        : isRetentionDrilldown
          ? [
              a.person_id,
              `${a.preferred_name ?? a.first_name} ${a.last_name}`,
              a.grade ?? '',
              a.gender ?? '',
              a.age ?? '',
              a.school ?? '',
              a.city ?? '',
              a.state ?? '',
              getSessionDisplay(a),
              getEnrolledDisplay(a),
              a.years_at_camp ?? '',
              a.status,
              a.is_returning ? 'Yes' : 'DNR',
            ]
          : isCancellationSpecial
            ? [
                a.person_id,
                `${a.preferred_name ?? a.first_name} ${a.last_name}`,
                a.grade ?? '',
                a.gender ?? '',
                a.age ?? '',
                a.school ?? '',
                a.city ?? '',
                a.state ?? '',
                getSessionDisplay(a),
                getEnrolledDisplay(a),
                formatDate(a.effective_date),
                formatDate(a.enrollment_date),
                a.years_at_camp ?? '',
                a.status,
                a.is_returning ? 'Yes' : 'No',
              ]
            : [
                a.person_id,
                `${a.preferred_name ?? a.first_name} ${a.last_name}`,
                a.grade ?? '',
                a.gender ?? '',
                a.age ?? '',
                a.school ?? '',
                a.city ?? '',
                a.state ?? '',
                getSessionDisplay(a),
                formatDate(getRegistrationDate(a)),
                a.years_at_camp ?? '',
                a.status,
                a.is_returning ? 'Yes' : 'No',
              ]
    )

    const stringRows = rows.map((row) => row.map((cell) => String(cell)))
    const csv = buildCsvContent(headers, stringRows)
    const filename = `${filter?.label.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    triggerCsvDownload(csv, filename)
  }

  if (!filter) return null

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-card border-border flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg border shadow-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">
              {filter.titleFormat === 'adjective'
                ? `${sortedAttendees.length} ${filter.label} Camper${sortedAttendees.length !== 1 ? 's' : ''}`
                : `${sortedAttendees.length} camper${sortedAttendees.length !== 1 ? 's' : ''} in ${filter.label}`}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isRetentionDrilldown
                ? `${filter.retentionContext?.baseYear} → ${filter.retentionContext?.compareYear} retention data`
                : `${year} enrollment data`}
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
              placeholder={
                isWaitlistDrilldown
                  ? 'Search by name, city, session, enrolled...'
                  : isRetentionDrilldown
                    ? 'Search by name, city, session...'
                    : isCancellationSpecial
                      ? 'Search by name, city, session...'
                      : 'Search by name, school, city, session...'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-background border-input focus:ring-ring w-full rounded-md border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <SortableColumnHeader
                  label="Name"
                  direction={headerDirection('name')}
                  onSort={() => handleSort('name')}
                  indicator={headerIndicator('name')}
                  buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                />
                <SortableColumnHeader
                  label="Grade"
                  direction={headerDirection('grade')}
                  onSort={() => handleSort('grade')}
                  indicator={headerIndicator('grade')}
                  buttonClassName="text-muted-foreground hover:text-foreground justify-center px-4 py-3 text-center font-medium"
                />
                <SortableColumnHeader
                  label="Gender"
                  direction={headerDirection('gender')}
                  onSort={() => handleSort('gender')}
                  indicator={headerIndicator('gender')}
                  buttonClassName="text-muted-foreground hover:text-foreground justify-center px-4 py-3 text-center font-medium"
                />
                {!isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial && (
                  <SortableColumnHeader
                    label="School"
                    direction={headerDirection('school')}
                    onSort={() => handleSort('school')}
                    indicator={headerIndicator('school')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                <SortableColumnHeader
                  label="City"
                  direction={headerDirection('city')}
                  onSort={() => handleSort('city')}
                  indicator={headerIndicator('city')}
                  buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                />
                <SortableColumnHeader
                  label={
                    isWaitlistDrilldown
                      ? 'Waitlisted For'
                      : isRetentionDrilldown
                        ? 'Prior Session'
                        : isCancellationSpecial
                          ? 'Cancelled Session'
                          : 'Session'
                  }
                  direction={headerDirection('session')}
                  onSort={() => handleSort('session')}
                  indicator={headerIndicator('session')}
                  buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                />
                {isWaitlistDrilldown && (
                  <SortableColumnHeader
                    label="Enrolled In"
                    direction={headerDirection('enrolled')}
                    onSort={() => handleSort('enrolled')}
                    indicator={headerIndicator('enrolled')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                {isWaitlistDrilldown && (
                  <SortableColumnHeader
                    label="Applied"
                    direction={headerDirection('registration')}
                    onSort={() => handleSort('registration')}
                    indicator={headerIndicator('registration')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                {isRetentionDrilldown && (
                  <SortableColumnHeader
                    label="Session"
                    direction={headerDirection('enrolled_current')}
                    onSort={() => handleSort('enrolled_current')}
                    indicator={headerIndicator('enrolled_current')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                {isCancellationSpecial && (
                  <>
                    <SortableColumnHeader
                      label="Current Session"
                      direction={headerDirection('enrolled')}
                      onSort={() => handleSort('enrolled')}
                      indicator={headerIndicator('enrolled')}
                      buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                    />
                    <SortableColumnHeader
                      label="Registered"
                      direction={headerDirection('registration')}
                      onSort={() => handleSort('registration')}
                      indicator={headerIndicator('registration')}
                      buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                    />
                    <SortableColumnHeader
                      label="Cancelled"
                      direction={headerDirection('cancelled')}
                      onSort={() => handleSort('cancelled')}
                      indicator={headerIndicator('cancelled')}
                      buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                    />
                  </>
                )}
                {!isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial && (
                  <SortableColumnHeader
                    label="Registered"
                    direction={headerDirection('registration')}
                    onSort={() => handleSort('registration')}
                    indicator={headerIndicator('registration')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                <SortableColumnHeader
                  label="Years"
                  direction={headerDirection('years')}
                  onSort={() => handleSort('years')}
                  indicator={headerIndicator('years')}
                  buttonClassName="text-muted-foreground hover:text-foreground justify-center px-4 py-3 text-center font-medium"
                />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={99} className="py-12 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="text-primary h-6 w-6 animate-spin" />
                      <span className="text-muted-foreground ml-2">Loading campers...</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={99} className="py-12 text-center text-red-600">
                    Failed to load data: {error.message}
                  </td>
                </tr>
              ) : sortedAttendees.length === 0 ? (
                <tr>
                  <td colSpan={99} className="text-muted-foreground py-12 text-center">
                    {searchTerm ? 'No campers match your search' : 'No campers found'}
                  </td>
                </tr>
              ) : (
                sortedAttendees.map((attendee, index) => (
                  <tr
                    key={`${attendee.person_id}-${attendee.session_cm_id}-${index}`}
                    className="border-border hover:bg-muted/30 border-b transition-colors last:border-0"
                  >
                    <td
                      className="text-foreground max-w-[180px] truncate px-4 py-3 font-medium"
                      title={`${attendee.preferred_name ?? attendee.first_name} ${attendee.last_name}`}
                    >
                      <Link
                        to={`/camper/${attendee.person_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-forest-700 dark:hover:text-forest-400 transition-colors"
                      >
                        {`${attendee.preferred_name ?? attendee.first_name} ${attendee.last_name}`}
                      </Link>
                      {attendee.is_returning && (
                        <span className="bg-primary/10 text-primary ml-1.5 rounded px-1 py-0.5 text-xs">
                          R
                        </span>
                      )}
                    </td>
                    <td className="text-foreground px-4 py-3 text-center whitespace-nowrap">
                      {attendee.grade ?? '—'}
                    </td>
                    <td className="text-foreground px-4 py-3 text-center whitespace-nowrap">
                      {attendee.gender ?? '—'}
                    </td>
                    {!isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial && (
                      <td
                        className="text-foreground max-w-[160px] truncate px-4 py-3"
                        title={attendee.school ?? undefined}
                      >
                        {attendee.school ?? '—'}
                      </td>
                    )}
                    <td
                      className="text-foreground max-w-[140px] truncate px-4 py-3"
                      title={
                        attendee.city
                          ? attendee.state
                            ? `${attendee.city}, ${attendee.state}`
                            : attendee.city
                          : undefined
                      }
                    >
                      {attendee.city
                        ? attendee.state
                          ? `${attendee.city}, ${attendee.state}`
                          : attendee.city
                        : '—'}
                    </td>
                    <td className="text-foreground px-4 py-3 whitespace-nowrap">
                      {getSessionDisplay(attendee)}
                    </td>
                    {isWaitlistDrilldown && (
                      <td
                        className="text-foreground max-w-[180px] truncate px-4 py-3"
                        title={getEnrolledDisplay(attendee)}
                      >
                        {getEnrolledDisplay(attendee)}
                      </td>
                    )}
                    {isWaitlistDrilldown && (
                      <td className="text-foreground px-4 py-3 whitespace-nowrap">
                        {formatDate(getRegistrationDate(attendee))}
                      </td>
                    )}
                    {isRetentionDrilldown && (
                      <td className="text-foreground px-4 py-3 whitespace-nowrap">
                        {getEnrolledDisplay(attendee) !== '—' ? getEnrolledDisplay(attendee) : '—'}
                        {!attendee.is_returning && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            DNR
                          </span>
                        )}
                      </td>
                    )}
                    {isCancellationSpecial && (
                      <>
                        <td
                          className="text-foreground max-w-[180px] truncate px-4 py-3"
                          title={getEnrolledDisplay(attendee)}
                        >
                          {getEnrolledDisplay(attendee)}
                        </td>
                        <td className="text-foreground px-4 py-3 whitespace-nowrap">
                          {formatDate(attendee.effective_date)}
                        </td>
                        <td className="text-foreground px-4 py-3 whitespace-nowrap">
                          {formatDate(attendee.enrollment_date)}
                        </td>
                      </>
                    )}
                    {!isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial && (
                      <td className="text-foreground px-4 py-3 whitespace-nowrap">
                        {formatDate(getRegistrationDate(attendee))}
                      </td>
                    )}
                    <td className="text-foreground px-4 py-3 text-center whitespace-nowrap">
                      {attendee.years_at_camp ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
