import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

  // #996 — Firefox download: anchor must be appended to DOM before click()
  describe('CSV download — Firefox DOM attachment (#996)', () => {
    it('appends anchor to document.body before click when Download CSV is clicked', () => {
      // Provide at least one attendee so the Download CSV button is not disabled
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

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      })
      // Track <a> elements appended to document.body during the download click
      const appendedAnchorCount = { value: 0 }
      const originalAppendChild = document.body.appendChild.bind(document.body)
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if ((node as HTMLElement).tagName === 'A') {
          appendedAnchorCount.value++
        }
        return originalAppendChild(node)
      })

      renderWithClient(<DrillDownModal {...defaultProps} />)

      const downloadBtn = screen.getByRole('button', { name: /download csv/i })
      expect(downloadBtn).not.toBeDisabled()
      fireEvent.click(downloadBtn)

      expect(appendedAnchorCount.value).toBeGreaterThan(0)
    })
  })
})
