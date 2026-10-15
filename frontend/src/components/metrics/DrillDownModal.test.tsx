import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrillDownModal } from './DrillDownModal'
import type { DrilldownAttendee, DrilldownFilter } from '../../types/metrics'

// Default mock returns empty data
let mockAttendees: DrilldownAttendee[] = []

// Mock the auth-dependent hook
vi.mock('../../hooks/useDrilldownAttendees', () => ({
  useDrilldownAttendees: () => ({
    data: mockAttendees,
    isLoading: false,
    error: null,
  }),
}))

// Capture CSV downloads; building the CSV text stays real.
const mockTriggerCsvDownload = vi.fn()
vi.mock('../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => mockTriggerCsvDownload(...args) as unknown,
}))

// Wrap component with QueryClient and MemoryRouter for React Query + Link
vi.mock('react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DrillDownModal', () => {
  const defaultProps = {
    year: 2025,
    filter: { type: 'grade' as const, value: '6', label: 'Grade 6' },
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAttendees = []
  })

  describe('keyboard accessibility', () => {
    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn()
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose for other keys', () => {
      const onClose = vi.fn()
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Enter' })
      fireEvent.keyDown(document, { key: 'Tab' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // #2068 — the 14 sortable columns were a bare `<th onClick>` with no tab
  // stop at all: no key press could sort them. Sweep every layout so a
  // partial conversion (some columns still plain <th>) would fail here.
  describe('#2068: sortable column headers are keyboard reachable', () => {
    function expectEveryHeaderHasAButton() {
      const headers = screen.getAllByRole('columnheader')
      expect(headers.length).toBeGreaterThan(0)
      headers.forEach((header) => {
        expect(within(header).getByRole('button').tagName).toBe('BUTTON')
      })
    }

    it('every header in the default layout is a real button', () => {
      renderWithClient(<DrillDownModal {...defaultProps} />)
      expectEveryHeaderHasAButton()
    })

    it('every header in the waitlist layout is a real button', () => {
      const filter: DrilldownFilter = { type: 'waitlist_total', value: '', label: 'Waitlist' }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)
      expectEveryHeaderHasAButton()
    })

    it('every header in the retention layout is a real button', () => {
      const filter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
        retentionContext: { baseYear: 2025, compareYear: 2026 },
      }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)
      expectEveryHeaderHasAButton()
    })

    it('every header in the cancellation-special layout is a real button', () => {
      const filter: DrilldownFilter = {
        type: 'cancellation_was_enrolled',
        value: '',
        label: 'Cancelled',
      }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)
      expectEveryHeaderHasAButton()
    })

    it('Tab reaches the Name header and Enter sorts it', async () => {
      mockAttendees = [
        {
          person_id: 1,
          first_name: 'Zara',
          last_name: 'Williams',
          grade: 5,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1,
          status: 'enrolled',
        } as DrilldownAttendee,
        {
          person_id: 2,
          first_name: 'Anna',
          last_name: 'Chen',
          grade: 5,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1,
          status: 'enrolled',
        } as DrilldownAttendee,
      ]

      renderWithClient(<DrillDownModal {...defaultProps} />)

      const nameButton = screen.getByRole('button', { name: 'Name' })
      nameButton.focus()
      await userEvent.keyboard('{Enter}')

      const header = nameButton.closest('[role="columnheader"]') as HTMLElement
      expect(['ascending', 'descending']).toContain(header.getAttribute('aria-sort'))
    })

    it('Space also sorts a header', async () => {
      renderWithClient(<DrillDownModal {...defaultProps} />)

      const yearsButton = screen.getByRole('button', { name: 'Years' })
      yearsButton.focus()
      await userEvent.keyboard(' ')

      const header = yearsButton.closest('[role="columnheader"]') as HTMLElement
      expect(['ascending', 'descending']).toContain(header.getAttribute('aria-sort'))
    })
  })

  describe('when filter is null', () => {
    it('renders nothing', () => {
      const { container } = renderWithClient(<DrillDownModal {...defaultProps} filter={null} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('does not respond to Escape key', () => {
      const onClose = vi.fn()
      renderWithClient(<DrillDownModal {...defaultProps} filter={null} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('basic rendering', () => {
    it('renders header with filter label', () => {
      renderWithClient(<DrillDownModal {...defaultProps} />)

      expect(screen.getByText(/Grade 6/)).toBeInTheDocument()
    })

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn()
      renderWithClient(<DrillDownModal {...defaultProps} onClose={onClose} />)

      // The X button doesn't have an accessible name, find by parent structure
      const closeButtons = screen.getAllByRole('button')
      const closeButton = closeButtons.find((btn) => btn.querySelector('svg.lucide-x'))

      if (closeButton) {
        fireEvent.click(closeButton)
      } else {
        // Alternative: find the button with just the X icon (last one in header area)
        const buttons = screen.getAllByRole('button')
        const lastButton = buttons[buttons.length - 1]
        if (lastButton) {
          fireEvent.click(lastButton)
        }
      }

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('title format', () => {
    it('uses "in" format by default: "X campers in Label"', () => {
      renderWithClient(<DrillDownModal {...defaultProps} />)

      expect(screen.getByText(/camper.*in Grade 6/)).toBeInTheDocument()
    })

    it('uses adjective format when titleFormat is "adjective": "X Label Campers"', () => {
      const filter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
        titleFormat: 'adjective',
      }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)

      // Should read "0 Female Campers" (not "0 campers in Female")
      expect(screen.getByText(/Female Camper/)).toBeInTheDocument()
      expect(screen.queryByText(/campers in Female/)).not.toBeInTheDocument()
    })

    it('adjective format uses plural "Campers" for count != 1', () => {
      mockAttendees = [
        {
          person_id: 101,
          first_name: 'Emma',
          last_name: 'Johnson',
          grade: 5,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1001,
          status: 'enrolled',
          is_returning: true,
        },
        {
          person_id: 102,
          first_name: 'Olivia',
          last_name: 'Chen',
          grade: 6,
          gender: 'F',
          session_name: 'Session 2',
          session_cm_id: 1002,
          status: 'enrolled',
          is_returning: false,
        },
      ]
      const filter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
        titleFormat: 'adjective',
      }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)

      expect(screen.getByText(/2 Female Campers/)).toBeInTheDocument()
    })
  })

  describe('retention mode', () => {
    const retentionFilter: DrilldownFilter = {
      type: 'gender',
      value: 'F',
      label: 'Female',
      retentionContext: { baseYear: 2025, compareYear: 2026 },
    }

    it('shows retention subtitle when retentionContext is present', () => {
      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      // Should show retention-specific subtitle instead of generic enrollment
      expect(screen.getByText(/retention data/i)).toBeInTheDocument()
    })

    it('hides School column in retention mode', () => {
      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      // In retention mode, School column should not appear in table headers
      const headers = screen.queryAllByRole('columnheader')
      const schoolHeader = headers.find((h) => h.textContent.includes('School'))
      expect(schoolHeader).toBeUndefined()
    })

    it('shows "Prior Session" column header in retention mode', () => {
      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      // Should show "Prior Session" instead of "Last Year's Session(s)"
      const headers = screen.queryAllByRole('columnheader')
      const priorHeader = headers.find((h) => h.textContent.includes('Prior Session'))
      expect(priorHeader).toBeDefined()
      // "Last Year" should NOT appear
      const lastYearHeader = headers.find((h) => h.textContent.includes('Last Year'))
      expect(lastYearHeader).toBeUndefined()
    })

    it('shows "Session" column header in retention mode for compare year', () => {
      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      const headers = screen.queryAllByRole('columnheader')
      // Should have a "Session" column distinct from "Prior Session"
      const sessionHeaders = headers.filter((h) => {
        const text = h.textContent
        return text.includes('Session') && !text.includes('Prior')
      })
      expect(sessionHeaders.length).toBeGreaterThanOrEqual(1)
    })

    it('shows DNR badge for non-returning campers in retention Session column', () => {
      mockAttendees = [
        {
          person_id: 101,
          first_name: 'Emma',
          last_name: 'Johnson',
          grade: 5,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1001,
          status: 'enrolled',
          is_returning: false,
          enrolled_sessions: [],
          sessions: [{ session_name: 'Session 1', session_cm_id: 1001 }],
        },
      ]

      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      // Should show DNR badge for non-returning camper
      expect(screen.getByText('DNR')).toBeInTheDocument()
    })

    it('does not show DNR badge for returning campers with enrolled sessions', () => {
      mockAttendees = [
        {
          person_id: 101,
          first_name: 'Emma',
          last_name: 'Johnson',
          grade: 5,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1001,
          status: 'enrolled',
          is_returning: true,
          enrolled_sessions: [{ session_name: 'Session 2', session_cm_id: 2001 }],
          sessions: [{ session_name: 'Session 1', session_cm_id: 1001 }],
        },
      ]

      renderWithClient(<DrillDownModal {...defaultProps} year={2025} filter={retentionFilter} />)

      expect(screen.queryByText('DNR')).not.toBeInTheDocument()
    })
  })

  // #996 — Firefox download: DOM attachment is tested in csvExport.test.ts
  // (downloadCsv unit tests cover the appendChild-before-click contract).
  // Here we verify that clicking Download CSV calls through to the shared utility
  // (i.e. the button is enabled and clickable when attendees are present).
  describe('CSV download button', () => {
    it('Download CSV button is enabled when attendees are present', () => {
      mockAttendees = [
        {
          person_id: 101,
          first_name: 'Emma',
          last_name: 'Johnson',
          grade: 6,
          gender: 'F',
          session_name: 'Session 1',
          session_cm_id: 1001,
          status: 'enrolled',
        } as DrilldownAttendee,
      ]

      renderWithClient(<DrillDownModal {...defaultProps} />)

      const downloadBtn = screen.getByRole('button', { name: /download csv/i })
      expect(downloadBtn).not.toBeDisabled()
    })
  })

  // #3207 PR 6a: dates read one day early in a Pacific browser. `effective_date` is a calendar
  // date stored as midnight UTC, so it is read by its YYYY-MM-DD part. `enrollment_date` is a true
  // UTC instant, so it shows its day on camp time (Pacific), whatever zone the browser is in.
  describe('dates in a non-UTC browser', () => {
    const originalTz = process.env['TZ']

    afterEach(() => {
      // Assigning undefined would store the string "undefined", so unset it instead.
      if (originalTz === undefined) delete process.env['TZ']
      else process.env['TZ'] = originalTz
      vi.useRealTimers()
    })

    const camper = (overrides: Partial<DrilldownAttendee>): DrilldownAttendee =>
      ({
        person_id: 101,
        first_name: 'Emma',
        last_name: 'Johnson',
        grade: 6,
        gender: 'F',
        session_name: 'Session 1',
        session_cm_id: 1001,
        status: 'enrolled',
        ...overrides,
      }) as DrilldownAttendee

    it('a Pacific browser shows the registered day itself, not the day before', () => {
      process.env['TZ'] = 'America/Los_Angeles'
      mockAttendees = [camper({ effective_date: '2025-12-17 00:00:00.000Z' })]

      renderWithClient(<DrillDownModal {...defaultProps} />)

      expect(screen.getByText('Dec 17, 2025')).toBeInTheDocument()
      expect(screen.queryByText('Dec 16, 2025')).not.toBeInTheDocument()
    })

    it('an eastern browser shows the registered day itself too', () => {
      process.env['TZ'] = 'America/New_York'
      mockAttendees = [camper({ effective_date: '2025-12-17 00:00:00.000Z' })]

      renderWithClient(<DrillDownModal {...defaultProps} />)

      expect(screen.getByText('Dec 17, 2025')).toBeInTheDocument()
    })

    it('a cancellation late on a Pacific evening shows that Pacific day, from any browser', () => {
      // 2026-03-04 05:30Z is 9:30 pm on Mar 3 in camp time.
      process.env['TZ'] = 'America/New_York'
      mockAttendees = [
        camper({
          status: 'cancelled',
          effective_date: '2025-11-12 00:00:00.000Z',
          enrollment_date: '2026-03-04 05:30:00.000Z',
        }),
      ]
      const filter: DrilldownFilter = {
        type: 'cancellation_was_enrolled',
        value: '',
        label: 'Cancelled',
      }

      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)

      expect(screen.getByText('Mar 3, 2026')).toBeInTheDocument()
      expect(screen.getByText('Nov 12, 2025')).toBeInTheDocument()
    })

    it('with no registered date, the fallback status date shows its camp-time day', () => {
      process.env['TZ'] = 'UTC'
      mockAttendees = [camper({ enrollment_date: '2026-03-04 05:30:00.000Z' })]

      renderWithClient(<DrillDownModal {...defaultProps} />)

      expect(screen.getByText('Mar 3, 2026')).toBeInTheDocument()
    })

    it('the CSV carries the same days, and is named <season>-<view>-<camp-time date>.csv', () => {
      process.env['TZ'] = 'UTC'
      // 03:00Z on Oct 16 is still the evening of Oct 15 on camp time.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-16T03:00:00Z'))
      mockAttendees = [camper({ effective_date: '2025-12-17 00:00:00.000Z' })]

      renderWithClient(<DrillDownModal {...defaultProps} />)
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))

      expect(mockTriggerCsvDownload).toHaveBeenCalledTimes(1)
      const [csv, filename] = mockTriggerCsvDownload.mock.calls[0] as [string, string]
      expect(csv).toContain('Dec 17, 2025')
      expect(csv).not.toContain('Dec 16, 2025')
      expect(filename).toBe('2025-grade-6-2026-10-15.csv')
    })
  })

  describe('number format', () => {
    it('separates the camper count in the header', () => {
      mockAttendees = Array.from({ length: 1293 }, (_, i) => ({
        person_id: i + 1,
        first_name: 'Emma',
        last_name: 'Johnson',
        grade: 5,
        gender: 'F',
        session_name: 'Session 1',
        session_cm_id: 1001,
        status: 'enrolled',
        is_returning: true,
      }))
      const filter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
        titleFormat: 'adjective',
      }
      renderWithClient(<DrillDownModal {...defaultProps} filter={filter} />)

      expect(screen.getByText(/1,293 Female Campers/)).toBeInTheDocument()
    })
  })
})
