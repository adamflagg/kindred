/**
 * TDD Tests for PipelineBatchList component.
 *
 * Tests that the batch list:
 * - Renders a summary table with correct columns
 * - Shows status color coding (green=RESOLVED, amber=PENDING, red=DECLINED)
 * - Shows confidence color coding (red < 0.70, amber 0.70-0.84, green >= 0.85)
 * - Filter changes call onFiltersChange
 * - Click row calls onRowClick with trace ID
 * - Shows empty state when no data
 * - Renders AI reasoning excerpt truncated
 * - Shows phase 3 triggered indicator
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineBatchList } from './PipelineBatchList'
import type { PipelineSummaryItem, PipelineSummaryFilters } from './types'

const mockItems: PipelineSummaryItem[] = [
  {
    id: 'sum1',
    run_id: 'run-abc-123',
    trace_id: 'trace-001',
    original_request_id: 'orig-001',
    bunk_request_id: 'br-001',
    requester_cm_id: 12345,
    requester_name: 'Emma Johnson',
    target_name: 'Liam Garcia',
    source_field: 'bunk_with',
    session_cm_id: 1000001,
    request_type: 'BUNK_WITH',
    final_status: 'RESOLVED',
    final_confidence: 0.95,
    resolution_method: 'exact_match',
    phase3_triggered: false,
    ai_reasoning_summary: 'Clear request for named camper with exact match found in roster.',
    pre_p1_action: 'parsed',
    year: 2026,
    disposition_reason: 'exact_match',
    is_reciprocal: true,
  },
  {
    id: 'sum2',
    run_id: 'run-abc-123',
    trace_id: 'trace-002',
    original_request_id: 'orig-002',
    bunk_request_id: null,
    requester_cm_id: 12346,
    requester_name: 'Olivia Chen',
    target_name: 'Noah Williams',
    source_field: 'not_bunk_with',
    session_cm_id: 1000001,
    request_type: 'NOT_BUNK_WITH',
    final_status: 'PENDING',
    final_confidence: 0.72,
    resolution_method: 'fuzzy',
    phase3_triggered: true,
    ai_reasoning_summary: 'Fuzzy match found but confidence below threshold. Multiple candidates.',
    pre_p1_action: 'parsed',
    year: 2026,
    disposition_reason: 'needs_review',
    is_reciprocal: false,
  },
  {
    id: 'sum3',
    run_id: 'run-abc-123',
    trace_id: 'trace-003',
    original_request_id: 'orig-003',
    bunk_request_id: null,
    requester_cm_id: 12347,
    requester_name: 'Sophia Martinez',
    target_name: 'Unknown Person',
    source_field: 'bunk_with',
    session_cm_id: 1000002,
    request_type: 'BUNK_WITH',
    final_status: 'DECLINED',
    final_confidence: 0.35,
    resolution_method: '',
    phase3_triggered: false,
    ai_reasoning_summary: 'No matching camper found in any session roster.',
    pre_p1_action: 'parsed',
    year: 2026,
    disposition_reason: 'target_not_attending',
    is_reciprocal: false,
  },
]

describe('PipelineBatchList', () => {
  const defaultProps = {
    items: mockItems,
    total: mockItems.length,
    filters: {} as PipelineSummaryFilters,
    onFiltersChange: vi.fn(),
    onRowClick: vi.fn(),
    isLoading: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Table rendering', () => {
    it('renders a table with column headers', () => {
      render(<PipelineBatchList {...defaultProps} />)

      // Check table headers exist in thead
      const thead = screen.getAllByRole('columnheader')
      const headerTexts = thead.map((th) => String(th.textContent).trim())
      expect(headerTexts).toContain('Camper')
      expect(headerTexts).toContain('Target')
      expect(headerTexts).toContain('Source')
      expect(headerTexts).toContain('Status')
      expect(headerTexts).toContain('Confidence')
      expect(headerTexts).toContain('Method')
      expect(headerTexts).toContain('P3')
    })

    it('renders a row for each summary item', () => {
      render(<PipelineBatchList {...defaultProps} />)

      expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
      expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
      expect(screen.getByText('Sophia Martinez')).toBeInTheDocument()
    })

    it('shows target names in rows', () => {
      render(<PipelineBatchList {...defaultProps} />)

      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
      expect(screen.getByText('Noah Williams')).toBeInTheDocument()
      expect(screen.getByText('Unknown Person')).toBeInTheDocument()
    })

    it('shows source field badges', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const bunkWithBadges = screen.getAllByText('Bunk With')
      // 2 table badges + 1 dropdown option = 3 matches
      expect(bunkWithBadges.length).toBe(3)
      // 'Not Bunk With' appears as 1 badge + 1 dropdown option
      expect(screen.getAllByText('Not Bunk With').length).toBe(2)
    })

    it('shows resolution method', () => {
      render(<PipelineBatchList {...defaultProps} />)

      // "exact_match" appears in both disposition_reason badge and resolution_method cell
      expect(screen.getAllByText('exact_match').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('fuzzy')).toBeInTheDocument()
    })

    it('shows phase 3 triggered indicator', () => {
      render(<PipelineBatchList {...defaultProps} />)

      // Olivia Chen had phase3_triggered = true
      const yesIndicators = screen.getAllByText('Yes')
      expect(yesIndicators.length).toBeGreaterThanOrEqual(1)

      const noIndicators = screen.getAllByText('No')
      expect(noIndicators.length).toBeGreaterThanOrEqual(1)
    })

    it('shows confidence values', () => {
      render(<PipelineBatchList {...defaultProps} />)

      expect(screen.getByText('0.95')).toBeInTheDocument()
      expect(screen.getByText('0.72')).toBeInTheDocument()
      expect(screen.getByText('0.35')).toBeInTheDocument()
    })
  })

  describe('Color coding', () => {
    it('applies green styling to RESOLVED status', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const resolvedBadge = screen.getByText('RESOLVED')
      expect(resolvedBadge.className).toMatch(/emerald|green/)
    })

    it('applies amber styling to PENDING status', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const pendingBadge = screen.getByText('PENDING')
      expect(pendingBadge.className).toMatch(/amber/)
    })

    it('applies red styling to DECLINED status', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const declinedBadge = screen.getByText('DECLINED')
      expect(declinedBadge.className).toMatch(/rose|red/)
    })

    it('applies green styling to high confidence (>= 0.85)', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const highConf = screen.getByText('0.95')
      expect(highConf.className).toMatch(/emerald|green/)
    })

    it('applies amber styling to medium confidence (0.70-0.84)', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const medConf = screen.getByText('0.72')
      expect(medConf.className).toMatch(/amber/)
    })

    it('applies red styling to low confidence (< 0.70)', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const lowConf = screen.getByText('0.35')
      expect(lowConf.className).toMatch(/rose|red/)
    })
  })

  describe('Row interaction', () => {
    it('calls onRowClick with trace_id when a row is clicked', async () => {
      const user = userEvent.setup()
      render(<PipelineBatchList {...defaultProps} />)

      const row = screen.getByText('Emma Johnson').closest('tr')!
      await user.click(row)

      expect(defaultProps.onRowClick).toHaveBeenCalledWith('trace-001')
    })

    it('shows clickable cursor on rows', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const row = screen.getByText('Emma Johnson').closest('tr')!
      expect(row.className).toMatch(/cursor-pointer/)
    })
  })

  describe('Filters', () => {
    it('renders status filter dropdown', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const statusFilter = screen.getByLabelText(/status/i)
      expect(statusFilter).toBeInTheDocument()
    })

    it('renders source field filter dropdown', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const sourceFilter = screen.getByLabelText(/source/i)
      expect(sourceFilter).toBeInTheDocument()
    })

    it('renders phase 3 filter dropdown', () => {
      render(<PipelineBatchList {...defaultProps} />)

      const p3Filter = screen.getByLabelText(/phase 3/i)
      expect(p3Filter).toBeInTheDocument()
    })

    it('calls onFiltersChange when status filter changes', async () => {
      const user = userEvent.setup()
      render(<PipelineBatchList {...defaultProps} />)

      const statusFilter = screen.getByLabelText(/status/i)
      await user.selectOptions(statusFilter, 'RESOLVED')

      expect(defaultProps.onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ final_status: 'RESOLVED' })
      )
    })

    it('calls onFiltersChange when source field filter changes', async () => {
      const user = userEvent.setup()
      render(<PipelineBatchList {...defaultProps} />)

      const sourceFilter = screen.getByLabelText(/source/i)
      await user.selectOptions(sourceFilter, 'bunk_with')

      expect(defaultProps.onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ source_field: 'bunk_with' })
      )
    })
  })

  describe('Empty and loading states', () => {
    it('shows loading state', () => {
      render(<PipelineBatchList {...defaultProps} isLoading={true} items={[]} total={0} />)

      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows empty state when no items', () => {
      render(<PipelineBatchList {...defaultProps} items={[]} total={0} />)

      expect(screen.getByText(/no results/i)).toBeInTheDocument()
    })

    it('renders error state when error prop is provided', () => {
      render(<PipelineBatchList {...defaultProps} error={new Error('Network failure')} />)
      expect(screen.getByText(/failed to load pipeline data/i)).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('does not render error state when error is null', () => {
      render(<PipelineBatchList {...defaultProps} error={null} />)
      expect(screen.queryByText(/failed to load pipeline data/i)).not.toBeInTheDocument()
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Total count', () => {
    it('shows total result count', () => {
      render(<PipelineBatchList {...defaultProps} total={42} />)

      // Total count appears in both the header ("42 results") and pagination ("Showing 3 of 42")
      expect(screen.getAllByText(/42/).length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Keyboard accessibility', () => {
    it('rows are keyboard-focusable with role=button', () => {
      render(<PipelineBatchList {...defaultProps} />)
      const rows = document.querySelectorAll('tbody tr')
      expect(rows.length).toBeGreaterThan(0)
      rows.forEach((row) => {
        expect(row).toHaveAttribute('tabindex', '0')
        expect(row).toHaveAttribute('role', 'button')
      })
    })

    it('triggers row click on Enter key', async () => {
      render(<PipelineBatchList {...defaultProps} />)
      const firstRow = document.querySelector('tbody tr') as HTMLElement
      firstRow.focus()
      await userEvent.keyboard('{Enter}')
      expect(defaultProps.onRowClick).toHaveBeenCalledWith(expect.any(String))
    })

    it('triggers row click on Space key', async () => {
      render(<PipelineBatchList {...defaultProps} />)
      const firstRow = document.querySelector('tbody tr') as HTMLElement
      firstRow.focus()
      await userEvent.keyboard(' ')
      expect(defaultProps.onRowClick).toHaveBeenCalledWith(expect.any(String))
    })

    it('triggers sort on Enter key on sortable header', async () => {
      render(<PipelineBatchList {...defaultProps} />)
      const sortableHeader = document.querySelector('thead th[tabindex]') as HTMLElement
      sortableHeader.focus()
      await userEvent.keyboard('{Enter}')
      expect(defaultProps.onFiltersChange).toHaveBeenCalled()
    })

    it('triggers sort on Space key on sortable header', async () => {
      render(<PipelineBatchList {...defaultProps} />)
      const sortableHeader = document.querySelector('thead th[tabindex]') as HTMLElement
      sortableHeader.focus()
      await userEvent.keyboard(' ')
      expect(defaultProps.onFiltersChange).toHaveBeenCalled()
    })
  })

  describe('disposition columns', () => {
    it('renders disposition_reason column with color-coded badges', () => {
      render(<PipelineBatchList {...defaultProps} />)
      const rows = document.querySelectorAll('tbody tr')

      // Helper: find the inner badge span (leaf node, exact text match)
      const findBadge = (row: Element, text: string): Element | null => {
        const spans = Array.from(row.querySelectorAll('span'))
        return (
          spans.find((s) => s.children.length === 0 && String(s.textContent).trim() === text) ??
          null
        )
      }

      const [row0, row1, row2] = [rows[0] as Element, rows[1] as Element, rows[2] as Element]

      // First row: "exact_match" — resolved (green)
      const dispositionBadge = findBadge(row0, 'exact_match')
      expect(dispositionBadge).not.toBeNull()
      expect(dispositionBadge!.className).toMatch(/emerald/)

      // Second row: "needs_review" — pending (amber)
      const pendingBadge = findBadge(row1, 'needs_review')
      expect(pendingBadge).not.toBeNull()
      expect(pendingBadge!.className).toMatch(/amber/)

      // Third row: "target_not_attending" — declined (red)
      const declinedBadge = findBadge(row2, 'target_not_attending')
      expect(declinedBadge).not.toBeNull()
      expect(declinedBadge!.className).toMatch(/rose/)
    })

    it('renders is_reciprocal indicator when true', () => {
      render(<PipelineBatchList {...defaultProps} />)
      const rows = document.querySelectorAll('tbody tr')

      // First row has is_reciprocal=true — should show "Recip" badge
      expect((rows[0] as Element).textContent).toMatch(/recip/i)

      // Second row has is_reciprocal=false — no "recip" indicator
      const secondRowRecip = Array.from((rows[1] as Element).querySelectorAll('td')).find((td) =>
        String(td.textContent).toLowerCase().includes('recip')
      )
      expect(secondRowRecip).toBeFalsy()
    })

    it('renders Reason column header', () => {
      render(<PipelineBatchList {...defaultProps} />)
      const headers = document.querySelectorAll('thead th')
      const headerTexts = Array.from(headers).map((h) => String(h.textContent).trim())
      expect(headerTexts).toContain('Reason')
    })
  })

  describe('Search input', () => {
    it('renders a search input field', () => {
      render(<PipelineBatchList {...defaultProps} />)
      const searchInput = screen.getByPlaceholderText(/search/i)
      expect(searchInput).toBeInTheDocument()
    })

    it('calls onFiltersChange with search value on input change', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        render(<PipelineBatchList {...defaultProps} />)
        const searchInput = screen.getByPlaceholderText(/search/i)
        await user.type(searchInput, 'Emma')
        // Advance past the 300ms debounce
        await vi.advanceTimersByTimeAsync(350)
        // Should have called onFiltersChange with a search value
        const calls = defaultProps.onFiltersChange.mock.calls
        expect(calls.length).toBeGreaterThan(0)
        const lastCall = calls[calls.length - 1]!
        expect(lastCall[0]).toHaveProperty('search', 'Emma')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('Pagination controls', () => {
    it('renders showing count text', () => {
      render(<PipelineBatchList {...defaultProps} total={150} />)
      expect(screen.getByText(/showing/i)).toBeInTheDocument()
    })

    it('renders a load-more button when more items available', () => {
      render(<PipelineBatchList {...defaultProps} total={150} />)
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
    })

    it('does not render load-more when all items shown', () => {
      render(<PipelineBatchList {...defaultProps} total={3} />)
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    })

    it('calls onLoadMore when load-more is clicked', async () => {
      const user = userEvent.setup()
      const onLoadMore = vi.fn()
      render(<PipelineBatchList {...defaultProps} total={150} onLoadMore={onLoadMore} />)
      await user.click(screen.getByRole('button', { name: /load more/i }))
      expect(onLoadMore).toHaveBeenCalled()
    })
  })
})
