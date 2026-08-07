/**
 * TDD Tests for StaffCabinAnalysisPage.
 *
 * Tests written FIRST before implementation (TDD).
 * Verifies the staff-centric retention table renders correctly
 * with sorting, color coding, portal tooltips with co-staff,
 * chronological session ordering, and proper loading/error/empty states.
 */
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'

// Mock the custom hooks
vi.mock('../../../hooks/useStaffRetentionData', () => ({
  useStaffRetentionData: vi.fn(),
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(() => ({
    campSessions: [],
  })),
}))

import { useStaffRetentionData } from '../../../hooks/useStaffRetentionData'
import type { StaffRetentionRow } from '../../../hooks/useStaffRetentionData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'

// Import the component under test
import StaffCabinAnalysisPage from './StaffCabinAnalysisPage'

const mockYearContext: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026, 2025],
  isTransitioning: false,
  isYearReady: true,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/analytics/retention/staff']}>
        <CurrentYearContext value={mockYearContext}>
          <Routes>
            <Route path="/analytics/retention/staff" element={<StaffCabinAnalysisPage />} />
          </Routes>
        </CurrentYearContext>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function makeRow(
  overrides: Partial<StaffRetentionRow> & { personId: string; name: string }
): StaffRetentionRow {
  return {
    sessionData: new Map(),
    overallRetention: 0,
    totalBaseCount: 0,
    totalReturnedCount: 0,
    ...overrides,
  }
}

describe('StaffCabinAnalysisPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loading/error/empty states', () => {
    it('shows loading state', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [],
        sessions: [],
        bunkStaff: new Map(),
        isLoading: true,
        error: null,
      })

      renderPage()

      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows error state', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [],
        sessions: [],
        bunkStaff: new Map(),
        isLoading: false,
        error: new Error('Network error'),
      })

      renderPage()

      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })

    it('shows empty state when no staff data', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [],
        sessions: [],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      expect(screen.getByText(/no.*data/i)).toBeInTheDocument()
    })
  })

  describe('header', () => {
    it('displays correct title with prior year', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [
          makeRow({
            personId: '101',
            name: 'Emma Johnson',
            overallRetention: 0.7,
            totalBaseCount: 10,
            totalReturnedCount: 7,
            sessionData: new Map([
              [
                'Session 1',
                { bunkName: 'B-1', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
            ]),
          }),
        ],
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      // Prior year = currentYear - 1 = 2025
      expect(screen.getByText(/staff cabin analysis/i)).toBeInTheDocument()
      expect(screen.getByText(/2025/)).toBeInTheDocument()
    })
  })

  describe('table rendering', () => {
    const mockStaffRows: StaffRetentionRow[] = [
      makeRow({
        personId: '101',
        name: 'Emma Johnson',
        overallRetention: 0.7,
        totalBaseCount: 20,
        totalReturnedCount: 14,
        sessionData: new Map([
          ['Session 1', { bunkName: 'B-3', baseCount: 10, returnedCount: 8, retentionRate: 0.8 }],
          ['Session 2', { bunkName: 'B-5', baseCount: 10, returnedCount: 6, retentionRate: 0.6 }],
        ]),
      }),
      makeRow({
        personId: '102',
        name: 'Liam Garcia',
        overallRetention: 0.35,
        totalBaseCount: 10,
        totalReturnedCount: 3,
        sessionData: new Map([
          ['Session 1', { bunkName: 'G-1', baseCount: 10, returnedCount: 3, retentionRate: 0.3 }],
        ]),
      }),
    ]

    function renderWithData() {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: mockStaffRows,
        sessions: ['Session 1', 'Session 2'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })
      return renderPage()
    }

    it('renders staff names in the table', () => {
      renderWithData()

      expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    })

    it('renders session column headers', () => {
      renderWithData()

      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    it('renders overall column header', () => {
      renderWithData()

      expect(screen.getByText('Overall')).toBeInTheDocument()
    })

    it('renders bunk names in cells', () => {
      renderWithData()

      expect(screen.getByText('B-3')).toBeInTheDocument()
      expect(screen.getByText('B-5')).toBeInTheDocument()
      expect(screen.getByText('G-1')).toBeInTheDocument()
    })

    it('renders retention percentages in cells', () => {
      renderWithData()

      expect(screen.getByText('80%')).toBeInTheDocument()
      expect(screen.getByText('60%')).toBeInTheDocument()
      expect(screen.getByText('30%')).toBeInTheDocument()
    })

    it('renders overall retention percentages', () => {
      renderWithData()

      expect(screen.getByText('70%')).toBeInTheDocument()
      expect(screen.getByText('35%')).toBeInTheDocument()
    })

    it('renders "---" for missing session data', () => {
      renderWithData()

      // Liam has no Session 2 data
      expect(screen.getByText('---')).toBeInTheDocument()
    })

    it('shows portal tooltip on session cell hover', () => {
      renderWithData()

      // Find Emma Johnson's row, get Session 1 cell (B-3, 80%)
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      // First cell is Session 1 (B-3, 80%)
      const session1Cell = cells.find((c) => c.textContent.includes('B-3'))!

      fireEvent.mouseEnter(session1Cell)

      // Portal tooltip shows retention stats
      expect(screen.getByText(/8 of 10 returned/)).toBeInTheDocument()
    })

    it('does not have title attributes on data cells', () => {
      renderWithData()

      expect(screen.queryByTitle(/returned/)).not.toBeInTheDocument()
    })
  })

  describe('color coding', () => {
    it('applies green color for retention >= 60%', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [
          makeRow({
            personId: '101',
            name: 'Emma Johnson',
            overallRetention: 0.7,
            totalBaseCount: 30,
            totalReturnedCount: 21,
            sessionData: new Map([
              [
                'Session 1',
                { bunkName: 'B-1', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
              [
                'Session 2',
                { bunkName: 'B-3', baseCount: 20, returnedCount: 14, retentionRate: 0.7 },
              ],
            ]),
          }),
        ],
        sessions: ['Session 1', 'Session 2'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      // Find the overall cell - last cell in Emma's row (sticky right)
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      const overallCell = cells[cells.length - 1]!
      expect(overallCell.className).toMatch(/emerald/)
    })

    it('applies red color for retention < 40%', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [
          makeRow({
            personId: '102',
            name: 'Liam Garcia',
            overallRetention: 0.3,
            totalBaseCount: 30,
            totalReturnedCount: 9,
            sessionData: new Map([
              [
                'Session 1',
                { bunkName: 'G-1', baseCount: 10, returnedCount: 3, retentionRate: 0.3 },
              ],
              [
                'Session 2',
                { bunkName: 'G-3', baseCount: 20, returnedCount: 6, retentionRate: 0.3 },
              ],
            ]),
          }),
        ],
        sessions: ['Session 1', 'Session 2'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      // Find the overall cell - last cell in Liam's row
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const liamRow = rows.find((r) => within(r).queryByText('Liam Garcia'))!
      const cells = within(liamRow).getAllByRole('cell')
      const overallCell = cells[cells.length - 1]!
      expect(overallCell.className).toMatch(/red/)
    })
  })

  describe('sorting', () => {
    const sortableRows: StaffRetentionRow[] = [
      makeRow({
        personId: '101',
        name: 'Zara Williams',
        overallRetention: 0.5,
        totalBaseCount: 10,
        totalReturnedCount: 5,
        sessionData: new Map([
          ['Session 1', { bunkName: 'B-1', baseCount: 10, returnedCount: 5, retentionRate: 0.5 }],
        ]),
      }),
      makeRow({
        personId: '102',
        name: 'Anna Chen',
        overallRetention: 0.8,
        totalBaseCount: 10,
        totalReturnedCount: 8,
        sessionData: new Map([
          ['Session 1', { bunkName: 'G-1', baseCount: 10, returnedCount: 8, retentionRate: 0.8 }],
        ]),
      }),
    ]

    it('initially sorts by name ascending', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      // Row 0 is header, row 1 and 2 are data
      const firstDataRow = rows[1]!
      expect(within(firstDataRow).getByText('Anna Chen')).toBeInTheDocument()
    })

    it('toggles sort direction on name column click', async () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()
      const user = userEvent.setup()

      // Sorting is triggered from the header's nested button, not the <th>
      // itself — the button is what makes the control keyboard-reachable.
      const staffButton = screen.getByRole('button', { name: /staff/i })
      await user.click(staffButton)

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const firstDataRow = rows[1]!
      // After clicking, should be descending: Zara first
      expect(within(firstDataRow).getByText('Zara Williams')).toBeInTheDocument()
    })

    it('sorts by overall retention when Overall header is clicked', async () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()
      const user = userEvent.setup()

      // Click "Overall" header's button
      const overallButton = screen.getByRole('button', { name: /overall/i })
      await user.click(overallButton)

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const firstDataRow = rows[1]!
      // Descending by default for overall: highest first
      expect(within(firstDataRow).getByText('Anna Chen')).toBeInTheDocument()
    })

    it('#2068: Staff header is keyboard-reachable and sortable with Enter', async () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      const staffButton = screen.getByRole('button', { name: /staff/i })
      staffButton.focus()
      await userEvent.keyboard('{Enter}')

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const firstDataRow = rows[1]!
      // Same toggle as the click test: descending puts Zara first
      expect(within(firstDataRow).getByText('Zara Williams')).toBeInTheDocument()
    })

    it('#2068: Overall header is keyboard-reachable and sortable with Space', async () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      const overallButton = screen.getByRole('button', { name: /overall/i })
      overallButton.focus()
      await userEvent.keyboard(' ')

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const firstDataRow = rows[1]!
      expect(within(firstDataRow).getByText('Anna Chen')).toBeInTheDocument()
    })

    it('#2068: aria-sort reflects the active column and is omitted on the inactive one', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: sortableRows,
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      expect(screen.getByRole('columnheader', { name: /staff/i })).toHaveAttribute(
        'aria-sort',
        'ascending'
      )
      expect(screen.getByRole('columnheader', { name: /overall/i })).not.toHaveAttribute(
        'aria-sort'
      )
    })
  })

  describe('legend', () => {
    it('renders color legend', () => {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [
          makeRow({
            personId: '101',
            name: 'Emma Johnson',
            overallRetention: 0.7,
            totalBaseCount: 10,
            totalReturnedCount: 7,
            sessionData: new Map([
              [
                'Session 1',
                { bunkName: 'B-1', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
            ]),
          }),
        ],
        sessions: ['Session 1'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      expect(screen.getByText('Retention:')).toBeInTheDocument()
      expect(screen.getByText(/Low \(/)).toBeInTheDocument()
      expect(screen.getByText(/Mid \(/)).toBeInTheDocument()
      expect(screen.getByText(/High \(/)).toBeInTheDocument()
    })
  })

  describe('portal tooltips and co-staff', () => {
    const bunkStaffMap = new Map([
      [
        'Session 1|B-3',
        [
          { name: 'Emma Johnson', personId: '101' },
          { name: 'Olivia Chen', personId: '103' },
        ],
      ],
      ['Session 2|B-5', [{ name: 'Emma Johnson', personId: '101' }]],
      ['Session 1|G-1', [{ name: 'Liam Garcia', personId: '102' }]],
    ])

    const staffRows: StaffRetentionRow[] = [
      makeRow({
        personId: '101',
        name: 'Emma Johnson',
        overallRetention: 0.7,
        totalBaseCount: 20,
        totalReturnedCount: 14,
        sessionData: new Map([
          ['Session 1', { bunkName: 'B-3', baseCount: 10, returnedCount: 8, retentionRate: 0.8 }],
          ['Session 2', { bunkName: 'B-5', baseCount: 10, returnedCount: 6, retentionRate: 0.6 }],
        ]),
      }),
      makeRow({
        personId: '102',
        name: 'Liam Garcia',
        overallRetention: 0.3,
        totalBaseCount: 10,
        totalReturnedCount: 3,
        sessionData: new Map([
          ['Session 1', { bunkName: 'G-1', baseCount: 10, returnedCount: 3, retentionRate: 0.3 }],
        ]),
      }),
    ]

    function renderWithCoStaff() {
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows,
        sessions: ['Session 1', 'Session 2'],
        bunkStaff: bunkStaffMap,
        isLoading: false,
        error: null,
      })
      return renderPage()
    }

    it('shows co-staff in tooltip when other staff share the bunk', () => {
      renderWithCoStaff()

      // Hover Emma's Session 1 cell (B-3) where Olivia is co-staff
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      const session1Cell = cells.find((c) => c.textContent.includes('B-3'))!

      fireEvent.mouseEnter(session1Cell)

      expect(screen.getByText('Co-Staff')).toBeInTheDocument()
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    })

    it('hides co-staff section when staff member is sole staff on bunk', () => {
      renderWithCoStaff()

      // Hover Emma's Session 2 cell (B-5) where she's the only staff
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      const session2Cell = cells.find((c) => c.textContent.includes('B-5'))!

      fireEvent.mouseEnter(session2Cell)

      // Retention stats should show
      expect(screen.getByText(/6 of 10 returned/)).toBeInTheDocument()
      // But no co-staff section
      expect(screen.queryByText('Co-Staff')).not.toBeInTheDocument()
    })

    it('hides tooltip on mouse leave', () => {
      renderWithCoStaff()

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      const session1Cell = cells.find((c) => c.textContent.includes('B-3'))!

      fireEvent.mouseEnter(session1Cell)
      expect(screen.getByText(/8 of 10 returned/)).toBeInTheDocument()

      fireEvent.mouseLeave(session1Cell)
      expect(screen.queryByText(/8 of 10 returned/)).not.toBeInTheDocument()
    })

    it('shows tooltip on overall cell hover', () => {
      renderWithCoStaff()

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const emmaRow = rows.find((r) => within(r).queryByText('Emma Johnson'))!
      const cells = within(emmaRow).getAllByRole('cell')
      // Overall cell is the last cell in the row
      const overallCell = cells[cells.length - 1]!

      fireEvent.mouseEnter(overallCell)

      expect(screen.getByText(/14 of 20 returned/)).toBeInTheDocument()
    })
  })

  describe('session column order', () => {
    it('orders session columns chronologically using campSessions dates', () => {
      // Mock campSessions with dates that differ from alphabetical order
      ;(useMetricsSession as Mock).mockReturnValue({
        campSessions: [
          { name: 'Taste of Camp', start_date: '2025-06-01' },
          { name: 'Session 1', start_date: '2025-06-15' },
          { name: 'Session 2', start_date: '2025-07-01' },
        ],
      })
      ;(useStaffRetentionData as Mock).mockReturnValue({
        staffRows: [
          makeRow({
            personId: '101',
            name: 'Emma Johnson',
            overallRetention: 0.7,
            totalBaseCount: 30,
            totalReturnedCount: 21,
            sessionData: new Map([
              [
                'Session 2',
                { bunkName: 'B-1', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
              [
                'Taste of Camp',
                { bunkName: 'B-2', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
              [
                'Session 1',
                { bunkName: 'B-3', baseCount: 10, returnedCount: 7, retentionRate: 0.7 },
              ],
            ]),
          }),
        ],
        // Hook returns alphabetical order
        sessions: ['Session 1', 'Session 2', 'Taste of Camp'],
        bunkStaff: new Map(),
        isLoading: false,
        error: null,
      })

      renderPage()

      // Get session column headers (exclude Staff and Overall)
      const headers = screen.getAllByRole('columnheader')
      const sessionHeaders = headers.filter((h) => !h.textContent.match(/staff|overall/i))

      // Should be chronological: Taste of Camp, Session 1, Session 2
      expect(sessionHeaders[0]!.textContent).toBe('Taste of Camp')
      expect(sessionHeaders[1]!.textContent).toBe('Session 1')
      expect(sessionHeaders[2]!.textContent).toBe('Session 2')
    })
  })
})
