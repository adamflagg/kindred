/**
 * Drill-down lists, epic #3207 PR 6 (decisions 8, 13, 37, 43, 44; owner rulings Q-FIT, Q-EN, Q-CG,
 * Q-LABEL, Q-NOTE, 2026-10-15). The approved mock is the spec:
 * - "Rows: Campers | Enrollments": one row per camper (today) or per enrollment, newest first.
 * - "Enrolled on" (enrollment_date's camp day) beside Registered, on lists of enrolled campers only.
 * - Cancellation lists call the camper's other sessions "Enrolled In", as waitlist lists do.
 * - The waitlist layout follows `waitlistContext` (it was never read).
 * - The CSV adds Zip and Caregivers (never modal columns), Age is the server's season rule, and an
 *   Enrollments download is named "-enrollments".
 * - Numbered notes say what Enrolled on means and what the CSV adds; the modal is 7xl wide.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrillDownModal } from './DrillDownModal'
import type { DrilldownAttendee, DrilldownFilter } from '../../types/metrics'

let mockAttendees: DrilldownAttendee[] = []

vi.mock('../../hooks/useDrilldownAttendees', () => ({
  useDrilldownAttendees: () => ({ data: mockAttendees, isLoading: false, error: null }),
}))

const mockTriggerCsvDownload = vi.fn()
vi.mock('../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => mockTriggerCsvDownload(...args) as unknown,
}))

vi.mock('react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
    [k: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

function renderModal(filter: DrilldownFilter, extra: { statusFilter?: string[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DrillDownModal year={2026} filter={filter} onClose={vi.fn()} {...extra} />
    </QueryClientProvider>
  )
}

const ENROLLED: DrilldownFilter = { type: 'status', value: 'enrolled', label: 'Enrolled Campers' }
const CANCELLED: DrilldownFilter = {
  type: 'cancellation_total',
  value: 'all',
  label: 'Total Cancelled',
}
const WAITLISTED: DrilldownFilter = {
  type: 'waitlist_total',
  value: 'all',
  label: 'Total Waitlisted',
}

function camper(overrides: Partial<DrilldownAttendee>): DrilldownAttendee {
  return {
    person_id: 1000001,
    first_name: 'Emma',
    last_name: 'Johnson',
    grade: 6,
    gender: 'F',
    session_name: 'Session 2',
    session_cm_id: 1001,
    status: 'enrolled',
    is_returning: false,
    ...overrides,
  }
}

/** Liam has two enrollments; Emma and Olivia one each. Instants are UTC; Pacific days noted. */
function threeCampers(): DrilldownAttendee[] {
  return [
    camper({
      person_id: 1000002,
      first_name: 'Liam',
      last_name: 'Garcia',
      effective_date: '2025-11-11 00:00:00.000Z',
      enrollment_date: '2025-11-12 17:00:00.000Z',
      sessions: [
        {
          session_name: 'Session 2',
          session_cm_id: 1001,
          effective_date: '2025-11-11 00:00:00.000Z',
          enrollment_date: '2025-11-12 17:00:00.000Z', // Nov 12
        },
        {
          session_name: 'Session 3',
          session_cm_id: 1002,
          effective_date: '2026-03-01 00:00:00.000Z',
          enrollment_date: '2026-04-10 18:00:00.000Z', // Apr 10
        },
      ],
    }),
    camper({
      person_id: 1000001,
      effective_date: '2026-01-31 00:00:00.000Z',
      enrollment_date: '2026-04-10 18:00:00.000Z', // Apr 10: ties Liam's second, Garcia sorts first
      sessions: [
        {
          session_name: 'Session 2',
          session_cm_id: 1001,
          effective_date: '2026-01-31 00:00:00.000Z',
          enrollment_date: '2026-04-10 18:00:00.000Z',
        },
      ],
    }),
    camper({
      person_id: 1000003,
      first_name: 'Olivia',
      last_name: 'Chen',
      effective_date: '2025-12-04 00:00:00.000Z',
      enrollment_date: '2025-12-04 19:00:00.000Z', // Dec 4
      sessions: [
        {
          session_name: 'Session 4',
          session_cm_id: 1003,
          effective_date: '2025-12-04 00:00:00.000Z',
          enrollment_date: '2025-12-04 19:00:00.000Z',
        },
      ],
    }),
  ]
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent.trim())
const bodyRows = () => screen.getAllByRole('row').slice(1)
const names = () =>
  bodyRows().map((r) => within(r).getAllByRole('cell')[0]?.textContent.replace(/R$/, '') ?? '')

function lastCsv(): { lines: string[]; filename: string } {
  const [csv, filename] = mockTriggerCsvDownload.mock.calls.at(-1) as [string, string]
  return { lines: csv.trim().split(/\r?\n/), filename }
}

describe('DrillDownModal — PR 6 lists', () => {
  const originalTz = process.env['TZ']
  beforeEach(() => {
    vi.clearAllMocks()
    mockAttendees = []
    process.env['TZ'] = 'UTC'
  })
  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ']
    else process.env['TZ'] = originalTz
    vi.useRealTimers()
  })

  describe('Q-FIT: the modal is 7xl wide', () => {
    it('widens the panel to max-w-7xl', () => {
      mockAttendees = threeCampers()
      renderModal(ENROLLED)
      const panel = screen.getByRole('heading', { level: 2 }).closest('.max-w-7xl')
      expect(panel).not.toBeNull()
    })
  })

  describe('Enrolled on (decision 37; Q-EN)', () => {
    it('sits beside Registered on a list of enrolled campers, as the camp-time day of enrollment_date', () => {
      mockAttendees = [threeCampers()[2]!]
      renderModal(ENROLLED)

      const hs = headers()
      expect(hs.indexOf('Enrolled on1')).toBe(hs.indexOf('Registered') + 1)
      const cells = within(bodyRows()[0]!)
        .getAllByRole('cell')
        .map((c) => c.textContent)
      expect(cells).toContain('Dec 4, 2025')
    })

    it('reads enrollment_date, never effective_date', () => {
      mockAttendees = [
        camper({
          effective_date: '2025-11-11 00:00:00.000Z',
          enrollment_date: '2025-11-12 17:00:00.000Z',
        }),
      ]
      renderModal(ENROLLED)

      const hs = headers()
      const cells = within(bodyRows()[0]!)
        .getAllByRole('cell')
        .map((c) => c.textContent)
      expect(cells[hs.indexOf('Registered')]).toBe('Nov 11, 2025')
      expect(cells[hs.indexOf('Enrolled on1')]).toBe('Nov 12, 2025')
    })

    it.each<[string, DrilldownFilter, { statusFilter?: string[] }]>([
      ['a waitlist list', WAITLISTED, {}],
      ['a cancellation list', CANCELLED, {}],
      [
        'No Other Sessions (cancelled rows)',
        { type: 'cancellation_no_other_sessions', value: 'all', label: 'No Other Sessions' },
        {},
      ],
      [
        'a chart of cancelled campers',
        {
          type: 'gender',
          value: 'F',
          label: 'F',
          statusOverride: ['cancelled', 'withdrawn', 'dismissed'],
        },
        {},
      ],
      [
        'a retention list',
        {
          type: 'retention_all',
          value: 'all',
          label: '2025 Total Campers',
          retentionContext: { baseYear: 2025, compareYear: 2026 },
        },
        {},
      ],
    ])('is not on %s', (_name, filter, extra) => {
      mockAttendees = threeCampers()
      renderModal(filter, extra)
      expect(headers().some((h) => h.startsWith('Enrolled on'))).toBe(false)
    })

    it('is on Re-enrolled, a list of enrolled campers', () => {
      mockAttendees = threeCampers()
      renderModal(
        { type: 'cancellation_re_enrolled', value: 'all', label: 'Re-enrolled' },
        {
          statusFilter: ['cancelled', 'withdrawn', 'dismissed'],
        }
      )
      expect(headers()).toContain('Enrolled on1')
    })
  })

  describe('Q-LABEL and the dead waitlistContext (decision 43)', () => {
    it('cancellation lists call the other sessions "Enrolled In"', () => {
      mockAttendees = threeCampers()
      renderModal(CANCELLED)
      expect(headers()).toContain('Enrolled In')
      expect(headers()).not.toContain('Current Session')
    })

    it('a grade bar with waitlistContext opens the waitlist columns', () => {
      mockAttendees = threeCampers()
      renderModal({
        type: 'grade',
        value: '5',
        label: 'Grade 5',
        statusOverride: ['waitlisted'],
        waitlistContext: true,
      })
      expect(headers()).toEqual(
        expect.arrayContaining(['Waitlisted For', 'Enrolled In', 'Applied'])
      )
      expect(headers()).not.toContain('School')
    })
  })

  describe('Rows: Campers | Enrollments (decision 8)', () => {
    it('opens on Campers: one row per camper, both sessions in one cell, the earliest dates', () => {
      mockAttendees = threeCampers()
      renderModal(ENROLLED)

      const rows = within(screen.getByRole('group', { name: 'Rows' }))
      expect(rows.getByRole('button', { name: 'Campers' })).toHaveAttribute('aria-pressed', 'true')
      expect(bodyRows()).toHaveLength(3)
      const liam = bodyRows().find((r) => r.textContent.includes('Liam'))!
      const cells = within(liam)
        .getAllByRole('cell')
        .map((c) => c.textContent)
      const hs = headers()
      expect(cells[hs.indexOf('Session')]).toBe('Session 2, Session 3')
      expect(cells[hs.indexOf('Enrolled on1')]).toBe('Nov 12, 2025')
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        '3 campers in Enrolled Campers'
      )
    })

    it('Enrollments shows one row per enrollment, newest first by Enrolled on, name breaking ties', () => {
      mockAttendees = threeCampers()
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))

      expect(names()).toEqual(['Liam Garcia', 'Emma Johnson', 'Olivia Chen', 'Liam Garcia'])
      const first = within(bodyRows()[0]!)
        .getAllByRole('cell')
        .map((c) => c.textContent)
      const hs = headers()
      expect(first[hs.indexOf('Session')]).toBe('Session 3')
      expect(first[hs.indexOf('Registered')]).toBe('Mar 1, 2026')
      expect(first[hs.indexOf('Enrolled on1')]).toBe('Apr 10, 2026')
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        '4 enrollments in Enrolled Campers'
      )
      expect(screen.getByText(/2026 enrollment data · 3 campers/)).toBeInTheDocument()
    })

    it('a cancellation list in Enrollments mode is newest first by Cancelled', () => {
      mockAttendees = threeCampers().map((a) => ({ ...a, status: 'cancelled' }))
      renderModal(CANCELLED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))

      const hs = headers()
      const cancelled = bodyRows().map(
        (r) => within(r).getAllByRole('cell')[hs.indexOf('Cancelled')]?.textContent
      )
      expect(cancelled).toEqual(['Apr 10, 2026', 'Apr 10, 2026', 'Dec 4, 2025', 'Nov 12, 2025'])
    })

    it('a waitlist list in Enrollments mode is newest first by Applied', () => {
      mockAttendees = threeCampers().map((a) => ({ ...a, status: 'waitlisted' }))
      renderModal(WAITLISTED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))

      const hs = headers()
      const applied = bodyRows().map(
        (r) => within(r).getAllByRole('cell')[hs.indexOf('Applied')]?.textContent
      )
      expect(applied).toEqual(['Mar 1, 2026', 'Jan 31, 2026', 'Dec 4, 2025', 'Nov 11, 2025'])
    })

    it('is not offered on a retention list', () => {
      mockAttendees = threeCampers()
      renderModal({
        type: 'retention_all',
        value: 'all',
        label: '2025 Total Campers',
        retentionContext: { baseYear: 2025, compareYear: 2026 },
      })
      expect(screen.queryByRole('group', { name: 'Rows' })).toBeNull()
    })
  })

  describe('numbered notes (Q-NOTE)', () => {
    it('explain Enrolled on and what the CSV adds, with their marks on the header and the button', () => {
      mockAttendees = threeCampers()
      renderModal(ENROLLED)

      expect(
        screen.getByText(/is the day the camper became enrolled, on camp time \(Pacific\)/)
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          /The CSV also has each camper's zip, their household ID and caregivers \(in the household's mailing-title order\), and Age = 2026 − birth year/
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /download csv/i }).querySelector('sup')?.textContent
      ).toBe('2')
    })

    it('without an Enrolled on column, the CSV note is note 1', () => {
      mockAttendees = threeCampers()
      renderModal(WAITLISTED)
      expect(screen.queryByText(/became enrolled/)).toBeNull()
      expect(
        screen.getByRole('button', { name: /download csv/i }).querySelector('sup')?.textContent
      ).toBe('1')
    })
  })

  describe('Download CSV (decisions 13, 44)', () => {
    it('adds Zip after State and Caregivers last, "; "-joined in stored order; Age is the server value', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-15T18:00:00Z'))
      mockAttendees = [
        camper({
          age: 12,
          zip: '94110',
          caregivers: ['Sarah Johnson', 'David Johnson'],
          effective_date: '2025-11-11 00:00:00.000Z',
          enrollment_date: '2025-11-12 17:00:00.000Z',
        }),
      ]
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))

      const { lines, filename } = lastCsv()
      expect(lines[0]).toBe(
        // PR 6b ruling #42: Household ID always sits before Caregivers
        'CampMinder ID,Name,Grade,Gender,Age,School,City,State,Zip,Session,Registered,Enrolled on,Years at Camp,Status,Returning,Household ID,Caregivers'
      )
      expect(lines[1]).toContain(',12,')
      expect(lines[1]).toContain(',94110,')
      expect(lines[1]).toContain('"Nov 11, 2025","Nov 12, 2025"')
      expect(lines[1]?.endsWith(',Sarah Johnson; David Johnson')).toBe(true)
      expect(filename).toBe('2026-enrolled-campers-2026-10-15.csv')
    })

    it('a cancellation CSV says Enrolled In', () => {
      mockAttendees = threeCampers()
      renderModal(CANCELLED)
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
      const { lines } = lastCsv()
      expect(lines[0]).toContain('Cancelled Session,Enrolled In,Registered,Cancelled')
    })

    it('follows the switch: one row per enrollment, named "-enrollments"', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-15T18:00:00Z'))
      mockAttendees = threeCampers()
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))

      const { lines, filename } = lastCsv()
      expect(lines).toHaveLength(5)
      expect(filename).toBe('2026-enrolled-campers-enrollments-2026-10-15.csv')
    })
  })
})
