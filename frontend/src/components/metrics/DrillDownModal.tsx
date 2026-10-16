/**
 * DrillDownModal - Modal displaying attendees matching a chart segment.
 *
 * Features:
 * - Header with count and filter description
 * - Search input to filter displayed results
 * - Sortable columns
 * - CSV export
 * - Rows: Campers | Enrollments (decision 8, #3207): one row per camper, or one per enrollment,
 *   newest first by the list's own date
 * - Enrolled on (decision 37) on lists of enrolled campers; the CSV adds Zip and Caregivers
 *   (decisions 13, 44), never as modal columns
 * - Group: Flat | Household (decision 39, PR 6b): every list, Retention included, can group its
 *   rows by the camper's primary childhood household; the CSV always has its Household ID
 */

import { formatCount } from '../../utils/numberFormat'
import { Fragment, useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router'
import { X, Download, Search, ArrowUpDown, Loader2 } from 'lucide-react'
import { SortIcon } from './SortIcon'
import {
  SortableColumnHeader,
  type SortDirection as HeaderSortDirection,
} from '../ui/SortableColumnHeader'
import { useDrilldownAttendees } from '../../hooks/useDrilldownAttendees'
import { sessionName } from '../../utils/sessionName'
import { buildCsvContent, downloadCsv as triggerCsvDownload } from '../../utils/csvExport'
import { campToday, formatLongDate } from '../camperships/kit/dates'
import { AidSegmented } from '../camperships/kit/Segmented'
import { DefinitionNotes, DefRef, type DefinitionNote } from '../camperships/kit/DefinitionNotes'
import { CS_BTN2, CS_FLABEL } from '../camperships/kit/csType'
import { GROUP_ROW_BAND } from '../camperships/kit/kitStyles'
import { groupByHousehold, householdCountWords } from './householdGroups'
import type { DrilldownAttendee, DrilldownFilter, DrilldownSession } from '../../types/metrics'

/** Get display session name: comma-joined if multi-session, fallback to single session_name. */
function getSessionDisplay(a: DrilldownAttendee): string {
  if (a.sessions && a.sessions.length > 0) {
    return a.sessions.map((s) => sessionName(s.session_name, undefined, 'short')).join(', ')
  }
  return sessionName(a.session_name, undefined, 'short')
}

/** Get enrolled sessions display: comma-joined or "—" if empty. */
function getEnrolledDisplay(a: DrilldownAttendee): string {
  if (a.enrolled_sessions && a.enrolled_sessions.length > 0) {
    return a.enrolled_sessions
      .map((s) => sessionName(s.session_name, undefined, 'short'))
      .join(', ')
  }
  return '—'
}

/** A calendar date ("Dec 17, 2025"). `effective_date` is a day stored as midnight UTC, so it is
 *  read by its YYYY-MM-DD part: through `new Date()` it would show the day before in a western zone. */
function formatDay(value: string | undefined | null): string {
  if (!value) return '—'
  return formatLongDate(value)
}

/** A moment's day on camp time ("Mar 3, 2026"). `enrollment_date` is a true UTC instant
 *  (CampMinder's PostDate), so its day is the Pacific one, whatever zone the browser is in. */
function formatCampDay(value: string | undefined | null): string {
  if (!value) return '—'
  const at = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(at.getTime())) return value
  return formatLongDate(campToday(at))
}

/** The registration date as shown: each source keeps its own reading (see formatDay, formatCampDay). */
function formatRegistrationDate(a: DrilldownAttendee): string {
  return a.effective_date ? formatDay(a.effective_date) : formatCampDay(a.enrollment_date)
}

/** Registered as shown. Beside Enrolled on it is effective_date alone, never the status date a
 *  second time; elsewhere it falls back to the status date (formatRegistrationDate). */
function formatRegisteredBeside(a: DrilldownAttendee, besideEnrolledOn: boolean): string {
  return besideEnrolledOn ? formatDay(a.effective_date) : formatRegistrationDate(a)
}

/** Registered's sortable day, read the way formatRegisteredBeside shows it. */
function registeredKey(a: DrilldownAttendee, besideEnrolledOn: boolean): string {
  return besideEnrolledOn || a.effective_date
    ? dayKey(a.effective_date)
    : campDayKey(a.enrollment_date)
}

/** A calendar date's sortable day: its YYYY-MM-DD part (see formatDay). */
function dayKey(value: string | undefined | null): string {
  return value ? value.slice(0, 10) : ''
}

/** An instant's sortable day: its camp-time YYYY-MM-DD (see formatCampDay). */
function campDayKey(value: string | undefined | null): string {
  if (!value) return ''
  const at = new Date(value.replace(' ', 'T'))
  return Number.isNaN(at.getTime()) ? value : campToday(at)
}

type RowsMode = 'campers' | 'enrollments'

const ROWS_OPTIONS = [
  { value: 'campers', label: 'Campers' },
  { value: 'enrollments', label: 'Enrollments' },
] as const

type GroupMode = 'flat' | 'household'

const GROUP_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'household', label: 'Household' },
] as const

/** "<season>-<view>[-enrollments]-<camp-time date>.csv", e.g. "2026-total-cancelled-2026-10-15.csv". */
function csvFilename(year: number, label: string | undefined, mode: RowsMode): string {
  const view =
    (label ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'campers'
  const rows = mode === 'enrollments' ? '-enrollments' : ''
  return `${String(year)}-${view}${rows}-${campToday()}.csv`
}

function earliest(values: ReadonlyArray<string | null | undefined>): string | undefined {
  let first: string | undefined
  for (const value of values) if (value && (first === undefined || value < first)) first = value
  return first
}

/** `a` with its two dates replaced (a missing one stays missing). */
function withDates(
  a: DrilldownAttendee,
  effective: string | null | undefined,
  enrolled: string | null | undefined
): DrilldownAttendee {
  const row: DrilldownAttendee = { ...a }
  delete row.effective_date
  delete row.enrollment_date
  if (effective) row.effective_date = effective
  if (enrolled) row.enrollment_date = enrolled
  return row
}

/** Campers mode: one row per camper. With two or more enrollments, both sessions share the
 *  Session cell (as today) and each date is the earliest of them. */
function camperRow(a: DrilldownAttendee): DrilldownAttendee {
  const sessions = a.sessions ?? []
  if (sessions.length < 2) return a
  return withDates(
    a,
    earliest(sessions.map((s) => s.effective_date)) ?? a.effective_date,
    earliest(sessions.map((s) => s.enrollment_date)) ?? a.enrollment_date
  )
}

/** Enrollments mode: one row per session in the camper's Session cell, each with its own dates. */
function enrollmentRows(a: DrilldownAttendee): DrilldownAttendee[] {
  const sessions = a.sessions ?? []
  if (sessions.length < 2) return [a]
  return sessions.map((s: DrilldownSession) => ({
    ...withDates(a, s.effective_date, s.enrollment_date),
    session_name: s.session_name,
    session_cm_id: s.session_cm_id,
    sessions: [s],
  }))
}

/** The kit's footnote mark (CS_SUP), in the primary button's own ink. */
const BUTTON_SUP =
  'static ml-px align-super text-[0.72em] leading-[0] font-medium tabular-nums opacity-75'

type CsvColumn = readonly [header: string, cell: (a: DrilldownAttendee) => string | number]

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
  | 'enrolled_on'
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
  // `??` never reached waitlistContext (startsWith returns a boolean), so the Waitlist page's grade
  // bars and gender rings opened the default columns (decision 43).
  const isWaitlistDrilldown =
    (filter?.type.startsWith('waitlist_') ?? false) || filter?.waitlistContext === true

  const [searchTerm, setSearchTerm] = useState('')
  // Today's "View all" opens at Enrollments, newest first by Enrolled on (#3207 PR 8)
  const opensAtEnrollments = filter?.initialRows === 'enrollments'
  const [sortField, setSortField] = useState<SortField>(
    opensAtEnrollments ? 'enrolled_on' : isWaitlistDrilldown ? 'registration' : 'name'
  )
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    opensAtEnrollments ? 'desc' : 'asc'
  )
  const isRetentionDrilldown = !!filter?.retentionContext
  const isCancellationDrilldown = filter?.type.startsWith('cancellation_') ?? false
  // These cancellation types use default layout (School + Session columns)
  const isCancellationDefaultLayout =
    filter?.type === 'cancellation_no_other_sessions' || filter?.type === 'cancellation_re_enrolled'
  // Show special cancellation columns (Cancelled Session + Enrolled In)
  const isCancellationSpecial = isCancellationDrilldown && !isCancellationDefaultLayout
  const isDefaultLayout = !isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial
  // "Enrolled on" only on lists of enrolled campers (owner Q-EN): on a cancelled or waitlisted row
  // enrollment_date is the date of that status, not of an enrollment.
  const showEnrolledOn =
    filter?.type === 'cancellation_re_enrolled' ||
    (isDefaultLayout &&
      !isCancellationDrilldown &&
      (filter?.statusOverride ?? statusFilter ?? ['enrolled']).every((s) => s === 'enrolled'))
  // A retention list asks whether a person came back, so it stays one row per camper.
  const showRowsSwitch = !isRetentionDrilldown
  const [rowsMode, setRowsMode] = useState<RowsMode>(opensAtEnrollments ? 'enrollments' : 'campers')
  const mode: RowsMode = showRowsSwitch ? rowsMode : 'campers'
  // "Newest first" reads each list's own date (mock, small proposals).
  const newestField: SortField = isWaitlistDrilldown
    ? 'registration'
    : isCancellationSpecial
      ? 'cancelled'
      : showEnrolledOn
        ? 'enrolled_on'
        : 'registration'

  // Every list opens Flat (owner ruling #37): the choice is never remembered.
  const [groupMode, setGroupMode] = useState<GroupMode>('flat')
  const grouped = groupMode === 'household'
  // Groups start open (#38). Which are closed is view state only, reset when Rows or Group changes.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const changeGroupMode = (next: GroupMode) => {
    setGroupMode(next)
    setFolded(new Set())
  }

  const changeRowsMode = (next: RowsMode) => {
    setRowsMode(next)
    setFolded(new Set())
    setSortField(
      next === 'enrollments' ? newestField : isWaitlistDrilldown ? 'registration' : 'name'
    )
    setSortDirection(next === 'enrollments' ? 'desc' : 'asc')
  }
  const formatRegistered = (a: DrilldownAttendee) => formatRegisteredBeside(a, showEnrolledOn)

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
  // CORRECT AS-IS, no overlay token (kindred#2237): it IS a full-viewport
  // modal (the fixed backdrop below), but its single mount site
  // (`hooks/useDrilldown.tsx`, on the metrics pages) puts no other
  // Escape-handling surface on screen with it — nothing to yield to, and
  // nothing that needs to yield to it.
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

  // One row per camper, or one per enrollment; Today's window keeps the enrollments Enrolled on since a day
  const since = filter?.enrolledSince
  const rows = useMemo(() => {
    const all =
      mode === 'enrollments' ? attendees.flatMap(enrollmentRows) : attendees.map(camperRow)
    if (!since) return all
    const enrolledDays = (a: DrilldownAttendee) =>
      a.sessions?.length
        ? a.sessions.map((s) => campDayKey(s.enrollment_date))
        : [campDayKey(a.enrollment_date)]
    return all.filter((a) => enrolledDays(a).some((day) => day !== '' && day >= since))
  }, [attendees, mode, since])

  // Filter rows by search term
  const filteredAttendees = useMemo(() => {
    if (!searchTerm.trim()) {
      return rows
    }
    const term = searchTerm.toLowerCase()
    return rows.filter(
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
  }, [rows, searchTerm, isWaitlistDrilldown, isRetentionDrilldown, isCancellationSpecial])

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
          aVal = registeredKey(a, showEnrolledOn)
          bVal = registeredKey(b, showEnrolledOn)
          break
        case 'enrolled_on':
        case 'cancelled':
          aVal = campDayKey(a.enrollment_date)
          bVal = campDayKey(b.enrollment_date)
          break
      }

      // Nulls/empty last for date sorts
      if (
        sortField === 'registration' ||
        sortField === 'cancelled' ||
        sortField === 'enrolled_on'
      ) {
        if (!aVal && bVal) return 1
        if (aVal && !bVal) return -1
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      // Ties read by name, A to Z, whichever way the column runs
      const aName = `${a.last_name} ${a.first_name}`.toLowerCase()
      const bName = `${b.last_name} ${b.first_name}`.toLowerCase()
      return aName < bName ? -1 : aName > bName ? 1 : 0
    })
    return sorted
  }, [filteredAttendees, sortField, sortDirection, showEnrolledOn])

  // Each household sits where its first camper sits in the sort (#39); search empties drop out,
  // but a group keeps the name and town its whole household gives it.
  const groups = useMemo(
    () => (grouped ? groupByHousehold(sortedAttendees, rows) : []),
    [grouped, sortedAttendees, rows]
  )
  // The list's order on screen, which the CSV follows (a closed group's rows included).
  const listedRows = grouped ? groups.flatMap((g) => g.rows) : sortedAttendees
  const anyFolded = groups.some((g) => folded.has(g.key))
  const allFolded = groups.every((g) => folded.has(g.key))
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
    const name = (a: DrilldownAttendee) => `${a.preferred_name ?? a.first_name} ${a.last_name}`
    // Zip and Caregivers are CSV-only (decisions 13, 44); Age is the server's season-year rule.
    const lead: CsvColumn[] = [
      ['CampMinder ID', (a) => a.person_id],
      ['Name', name],
      ['Grade', (a) => a.grade ?? ''],
      ['Gender', (a) => a.gender ?? ''],
      ['Age', (a) => a.age ?? ''],
      ['School', (a) => a.school ?? ''],
      ['City', (a) => a.city ?? ''],
      ['State', (a) => a.state ?? ''],
      ['Zip', (a) => a.zip ?? ''],
    ]
    const middle: CsvColumn[] = isWaitlistDrilldown
      ? [
          ['Waitlisted For', getSessionDisplay],
          ['Enrolled In', getEnrolledDisplay],
          ['Applied', formatRegistrationDate],
        ]
      : isRetentionDrilldown
        ? [
            ['Prior Session', getSessionDisplay],
            ['Session', getEnrolledDisplay],
          ]
        : isCancellationSpecial
          ? [
              ['Cancelled Session', getSessionDisplay],
              ['Enrolled In', getEnrolledDisplay],
              ['Registered', (a) => formatDay(a.effective_date)],
              ['Cancelled', (a) => formatCampDay(a.enrollment_date)],
            ]
          : [
              ['Session', getSessionDisplay],
              ['Registered', formatRegistered],
              ...(showEnrolledOn
                ? [
                    [
                      'Enrolled on',
                      (a: DrilldownAttendee) => formatCampDay(a.enrollment_date),
                    ] as const,
                  ]
                : []),
            ]
    const tail: CsvColumn[] = [
      ['Years at Camp', (a) => a.years_at_camp ?? ''],
      ['Status', (a) => a.status],
      ['Returning', (a) => (a.is_returning ? 'Yes' : isRetentionDrilldown ? 'DNR' : 'No')],
      // Grouped or not, every list's file has it (owner ruling #42).
      ['Household ID', (a) => a.household_cm_id ?? ''],
      ['Caregivers', (a) => (a.caregivers ?? []).join('; ')],
    ]
    const columns = [...lead, ...middle, ...tail]

    // The CSV follows the switches: one row per camper or per enrollment, in the list's order.
    const headers = columns.map(([header]) => header)
    const stringRows = listedRows.map((a) => columns.map(([, cell]) => String(cell(a))))
    const csv = buildCsvContent(headers, stringRows)
    triggerCsvDownload(csv, csvFilename(year, filter?.label, mode))
  }

  // Numbered notes, never hover (owner Q-NOTE): what Enrolled on means, and what the CSV adds.
  const csvNote = showEnrolledOn ? 2 : 1
  const notes: DefinitionNote[] = [
    ...(showEnrolledOn
      ? [
          {
            n: 1,
            text: 'Enrolled on is the day the camper became enrolled, on camp time (Pacific). Registered is the day they registered. A priority-day sign-up is often enrolled the next morning.',
            alsoBold: ['Enrolled on', 'Registered'],
          },
        ]
      : []),
    {
      n: csvNote,
      text: `The CSV also has each camper's zip, their household ID and caregivers (in the household's mailing-title order), and Age = ${String(year)} − birth year, the rule CampMinder uses (blank with no birth date).`,
    },
    ...(grouped
      ? [
          {
            n: csvNote + 1,
            text: "A household is the camper's primary childhood household in CampMinder, the one CampMinder groups by. It is named for its campers' surnames, with its town.",
            alsoBold: ['household'],
          },
        ]
      : []),
  ]
  const noun = mode === 'enrollments' ? 'enrollment' : 'camper'
  const shownCampers = new Set(sortedAttendees.map((a) => a.person_id)).size
  const showSchool = !isWaitlistDrilldown && !isRetentionDrilldown && !isCancellationSpecial
  // Name, Grade, Gender, City, the session column and Years, plus each layout's own columns.
  const columnCount =
    6 +
    (showSchool ? 1 : 0) +
    (isWaitlistDrilldown ? 2 : 0) +
    (isRetentionDrilldown ? 1 : 0) +
    (isCancellationSpecial ? 3 : 0) +
    (isDefaultLayout ? 1 : 0) +
    (showEnrolledOn ? 1 : 0)

  const attendeeRow = (attendee: DrilldownAttendee, index: number) => (
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
          <span className="bg-primary/10 text-primary ml-1.5 rounded px-1 py-0.5 text-xs">R</span>
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
      <td className="text-foreground px-4 py-3 whitespace-nowrap">{getSessionDisplay(attendee)}</td>
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
          {formatRegistrationDate(attendee)}
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
            {formatDay(attendee.effective_date)}
          </td>
          <td className="text-foreground px-4 py-3 whitespace-nowrap">
            {formatCampDay(attendee.enrollment_date)}
          </td>
        </>
      )}
      {isDefaultLayout && (
        <td className="text-foreground px-4 py-3 whitespace-nowrap">
          {formatRegistered(attendee)}
        </td>
      )}
      {showEnrolledOn && (
        <td className="text-foreground px-4 py-3 whitespace-nowrap">
          {formatCampDay(attendee.enrollment_date)}
        </td>
      )}
      <td className="text-foreground px-4 py-3 text-center whitespace-nowrap">
        {attendee.years_at_camp ?? '—'}
      </td>
    </tr>
  )

  if (!filter) return null

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-card border-border flex max-h-[85vh] w-full max-w-7xl flex-col rounded-lg border shadow-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">
              {filter.titleFormat === 'adjective'
                ? `${formatCount(sortedAttendees.length)} ${filter.label} ${noun === 'camper' ? 'Camper' : 'Enrollment'}${sortedAttendees.length !== 1 ? 's' : ''}`
                : `${formatCount(sortedAttendees.length)} ${noun}${sortedAttendees.length !== 1 ? 's' : ''} in ${filter.label}`}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isRetentionDrilldown
                ? `${filter.retentionContext?.baseYear} → ${filter.retentionContext?.compareYear} retention data`
                : `${year} enrollment data`}
              {mode === 'enrollments' &&
                ` · ${formatCount(shownCampers)} camper${shownCampers !== 1 ? 's' : ''}`}
              {grouped &&
                groups.length > 0 &&
                ` · ${formatCount(groups.length)} household${groups.length !== 1 ? 's' : ''}`}
              {searchTerm && ` (filtered from ${formatCount(rows.length)})`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCsv}
              disabled={sortedAttendees.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>
                Download CSV<sup className={BUTTON_SUP}>{csvNote}</sup>
              </span>
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Search, and the Rows switch */}
        <div className="border-border flex items-center gap-3 border-b px-6 py-3">
          <div className="relative flex-1">
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
          {showRowsSwitch && (
            <>
              <span className={CS_FLABEL}>Rows</span>
              <AidSegmented
                label="Rows"
                value={mode}
                options={ROWS_OPTIONS}
                onChange={changeRowsMode}
              />
            </>
          )}
          <span className={CS_FLABEL}>Group</span>
          <AidSegmented
            label="Group"
            value={groupMode}
            options={GROUP_OPTIONS}
            onChange={changeGroupMode}
          />
          {/* Open All / Close All keep their space while Flat, so the switches never move (#36). */}
          <span
            data-fold-buttons=""
            aria-hidden={!grouped || undefined}
            className={grouped ? 'flex flex-none gap-2' : 'invisible flex flex-none gap-2'}
          >
            <button
              type="button"
              className={CS_BTN2}
              disabled={!grouped || !anyFolded}
              onClick={() => setFolded(new Set())}
            >
              Open All
            </button>
            <button
              type="button"
              className={CS_BTN2}
              disabled={!grouped || allFolded}
              onClick={() => setFolded(new Set(groups.map((g) => g.key)))}
            >
              Close All
            </button>
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 z-10">
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
                      label="Enrolled In"
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
                {isDefaultLayout && (
                  <SortableColumnHeader
                    label="Registered"
                    direction={headerDirection('registration')}
                    onSort={() => handleSort('registration')}
                    indicator={headerIndicator('registration')}
                    buttonClassName="text-muted-foreground hover:text-foreground px-4 py-3 text-left font-medium"
                  />
                )}
                {showEnrolledOn && (
                  <SortableColumnHeader
                    label="Enrolled on"
                    direction={headerDirection('enrolled_on')}
                    onSort={() => handleSort('enrolled_on')}
                    indicator={
                      <>
                        <DefRef n={1} />
                        {headerIndicator('enrolled_on')}
                      </>
                    }
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
              ) : grouped ? (
                groups.map((g) => {
                  const closed = folded.has(g.key)
                  return (
                    <Fragment key={g.key}>
                      <tr>
                        {/* The kit's green section row (#46); the heading folds its group. */}
                        <td
                          colSpan={columnCount}
                          className={`${GROUP_ROW_BAND} px-4`}
                          data-group-heading=""
                        >
                          <button
                            type="button"
                            className="sticky left-4 cursor-pointer"
                            onClick={() => toggleFold(g.key)}
                          >
                            <span className="mr-1 inline-block">{closed ? '▸' : '▾'}</span>
                            <span>{g.label}</span>
                            {g.town && (
                              <span className="text-muted-foreground font-normal">
                                {` · ${g.town}`}
                              </span>
                            )}
                          </button>
                          <span
                            data-group-count=""
                            className="text-muted-foreground ml-1.5 text-xs font-normal"
                          >
                            {householdCountWords(g.campers, g.rows.length, mode)}
                          </span>
                        </td>
                      </tr>
                      {!closed && g.rows.map(attendeeRow)}
                    </Fragment>
                  )
                })
              ) : (
                sortedAttendees.map(attendeeRow)
              )}
            </tbody>
          </table>
        </div>

        {/* Numbered notes */}
        <div className="border-border border-t px-6 pb-2">
          <DefinitionNotes notes={notes} />
        </div>
      </div>
    </div>
  )
}
