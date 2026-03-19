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

      expect(screen.getByText('exact_match')).toBeInTheDocument()
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

      expect(screen.getByText(/42/)).toBeInTheDocument()
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
})
