/**
 * TDD Tests for StaffCabinAnalysisPage.
 *
 * Tests written FIRST before implementation (TDD).
 * Verifies the staff-centric retention table renders correctly
 * with sorting, color coding, and proper loading/error/empty states.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'

// Mock the custom hook
vi.mock('../../../hooks/useStaffRetentionData', () => ({
  useStaffRetentionData: vi.fn(),
}))

import { useStaffRetentionData } from '../../../hooks/useStaffRetentionData'
import type { StaffRetentionRow } from '../../../hooks/useStaffRetentionData'

// Import the component under test
import StaffCabinAnalysisPage from './StaffCabinAnalysisPage'

const mockYearContext: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026, 2025],
  isTransitioning: false,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/metrics/retention/staff']}>
        <CurrentYearContext.Provider value={mockYearContext}>
          <Routes>
            <Route path="/metrics/retention/staff" element={<StaffCabinAnalysisPage />} />
          </Routes>
        </CurrentYearContext.Provider>
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

    it('shows title tooltip with return counts on data cells', () => {
      renderWithData()

      // Find cells with title attributes containing return info
      const cellWithTooltip = screen.getByTitle('8 of 10 returned')
      expect(cellWithTooltip).toBeInTheDocument()
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
        isLoading: false,
        error: null,
      })

      renderPage()

      // The overall cell has unique return counts (aggregated across sessions)
      const overallCell = screen.getByTitle('21 of 30 returned')
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
        isLoading: false,
        error: null,
      })

      renderPage()

      const overallCell = screen.getByTitle('9 of 30 returned')
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
        isLoading: false,
        error: null,
      })

      renderPage()
      const user = userEvent.setup()

      // Click "Staff" header to toggle sort
      const staffHeader = screen.getByRole('columnheader', { name: /staff/i })
      await user.click(staffHeader)

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
        isLoading: false,
        error: null,
      })

      renderPage()
      const user = userEvent.setup()

      // Click "Overall" header
      const overallHeader = screen.getByRole('columnheader', { name: /overall/i })
      await user.click(overallHeader)

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      const firstDataRow = rows[1]!
      // Descending by default for overall: highest first
      expect(within(firstDataRow).getByText('Anna Chen')).toBeInTheDocument()
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
})
