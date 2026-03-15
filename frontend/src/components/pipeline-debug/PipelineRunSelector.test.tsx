/**
 * TDD Tests for PipelineRunSelector component.
 *
 * Tests that the run selector:
 * - Renders a dropdown of pipeline runs with metadata
 * - Displays timestamp, session, trace count, and status breakdown
 * - Calls onSelectRun when a run is selected
 * - Shows pin button and calls toggle pin on click
 * - Shows source fields as badges
 * - Shows empty state when no runs available
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineRunSelector } from './PipelineRunSelector'
import type { PipelineRun } from './types'

const mockRuns: PipelineRun[] = [
  {
    id: 'rec1',
    run_id: 'run-abc-123',
    year: 2026,
    session: 'all',
    source_fields: ['bunk_with', 'not_bunk_with'],
    limit_param: 0,
    force: false,
    trace_count: 42,
    status_breakdown: { resolved: 30, pending: 8, declined: 4, skipped: 0 },
    pinned: false,
    created: '2026-03-15T10:30:00Z',
  },
  {
    id: 'rec2',
    run_id: 'run-def-456',
    year: 2026,
    session: '1',
    source_fields: ['bunk_with'],
    limit_param: 10,
    force: true,
    trace_count: 10,
    status_breakdown: { resolved: 7, pending: 2, declined: 1, skipped: 0 },
    pinned: true,
    created: '2026-03-14T08:15:00Z',
  },
]

describe('PipelineRunSelector', () => {
  const defaultProps = {
    runs: mockRuns,
    selectedRunId: null as string | null,
    onSelectRun: vi.fn(),
    onTogglePin: vi.fn(),
    isPinning: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a dropdown with run options', () => {
    render(<PipelineRunSelector {...defaultProps} />)

    // Should show the placeholder text when nothing is selected
    expect(screen.getByText(/select a run/i)).toBeInTheDocument()
  })

  it('displays run metadata in dropdown options', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId={null} />)

    // Both runs should be listed
    const options = screen.getAllByRole('option')
    // +1 for placeholder option
    expect(options).toHaveLength(3)
  })

  it('shows trace count for each run option', () => {
    render(<PipelineRunSelector {...defaultProps} />)

    expect(screen.getByText(/42 traces/i)).toBeInTheDocument()
    expect(screen.getByText(/10 traces/i)).toBeInTheDocument()
  })

  it('shows session info for each run', () => {
    render(<PipelineRunSelector {...defaultProps} />)

    expect(screen.getByText(/session: all/i)).toBeInTheDocument()
    expect(screen.getByText(/session: 1/i)).toBeInTheDocument()
  })

  it('shows status breakdown counts for selected run', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" />)

    // Status badges in metadata panel show resolved/pending/declined counts
    // Use getAllByText since the number may appear in both option text and badge
    const badges = screen.getAllByText('30')
    expect(badges.length).toBeGreaterThanOrEqual(1)
    const pendingBadges = screen.getAllByText('8')
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onSelectRun when a run is chosen', async () => {
    const user = userEvent.setup()
    render(<PipelineRunSelector {...defaultProps} />)

    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'run-abc-123')

    expect(defaultProps.onSelectRun).toHaveBeenCalledWith('run-abc-123')
  })

  it('highlights the selected run', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('run-abc-123')
  })

  it('renders pin button for selected run', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" />)

    const pinButton = screen.getByRole('button', { name: /pin/i })
    expect(pinButton).toBeInTheDocument()
  })

  it('calls onTogglePin when pin button is clicked', async () => {
    const user = userEvent.setup()
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" />)

    const pinButton = screen.getByRole('button', { name: /pin/i })
    await user.click(pinButton)

    expect(defaultProps.onTogglePin).toHaveBeenCalledWith('run-abc-123')
  })

  it('shows pinned indicator for pinned run', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-def-456" />)

    // Pinned run should show the unpin label
    const pinButton = screen.getByRole('button', { name: /unpin/i })
    expect(pinButton).toBeInTheDocument()
  })

  it('disables pin button while pinning', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" isPinning={true} />)

    const pinButton = screen.getByRole('button', { name: /pin/i })
    expect(pinButton).toBeDisabled()
  })

  it('shows metadata panel when a run is selected', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-abc-123" />)

    // Should display source fields as badges in the metadata panel
    // Use getAllByText since field names appear in both option text and metadata badges
    const bunkWithElements = screen.getAllByText('bunk_with')
    expect(bunkWithElements.length).toBeGreaterThanOrEqual(1)
    const notBunkWithElements = screen.getAllByText('not_bunk_with')
    expect(notBunkWithElements.length).toBeGreaterThanOrEqual(1)
  })

  it('shows force indicator when run used force mode', () => {
    render(<PipelineRunSelector {...defaultProps} selectedRunId="run-def-456" />)

    expect(screen.getByText(/force/i)).toBeInTheDocument()
  })

  it('shows empty state when no runs exist', () => {
    render(<PipelineRunSelector {...defaultProps} runs={[]} />)

    expect(screen.getByText(/no pipeline runs/i)).toBeInTheDocument()
  })
})
