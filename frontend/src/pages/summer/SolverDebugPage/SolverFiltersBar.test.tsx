import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SolverFiltersBar } from './SolverFiltersBar'
import { DEFAULT_VISIBLE_COLUMNS } from './solverColumns'

const fakeSessions = [
  { cm_id: 1000001, name: 'Session 1', year: 2026 },
  { cm_id: 1000002, name: 'Session 2', year: 2026 },
]

describe('SolverFiltersBar', () => {
  it('renders filter dropdowns and column picker toggle', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/filter by session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })

  it('all action buttons have explicit type="button" so they never act as form submits', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /columns/i })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: /export json/i })).toHaveAttribute('type', 'button')
  })

  it('renders an Export JSON button next to Columns and calls onExport when clicked', () => {
    const onExport = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={onExport}
      />
    )
    const btn = screen.getByRole('button', { name: /export json/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('renders session options dynamically from the sessions prop', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    const select = screen.getByLabelText<HTMLSelectElement>(/filter by session/i)
    const values = Array.from(select.options).map((o) => o.value)
    // The first option is the empty "All sessions" sentinel; the rest must be real cm_ids.
    expect(values).toEqual(['', '1000001', '1000002'])
  })

  it('emits real cm_id when a session is selected', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by session/i), {
      target: { value: '1000002' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 1000002 }))
  })

  it('emits sourceKind when source dropdown changes', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by source/i), {
      target: { value: 'production' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'production' }))
  })

  it('drops sourceKind when source dropdown reset to All', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{ sourceKind: 'scenario' }}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by source/i), { target: { value: '' } })
    const arg = onChange.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    expect(arg.sourceKind).toBeUndefined()
  })

  it('renders sweep options derived from availableSweeps', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        availableSweeps={[
          { id: 'sw_abc1234', label: 'post-cleanup', count: 4 },
          { id: 'sw_def5678', label: 'baseline', count: 4 },
        ]}
        onExport={vi.fn()}
      />
    )
    const select = screen.getByLabelText<HTMLSelectElement>(/filter by sweep/i)
    const values = Array.from(select.options).map((o) => o.value)
    // '' = All, '__manual__' = Manual runs only, then real sweep ids.
    expect(values).toEqual(['', '__manual__', 'sw_abc1234', 'sw_def5678'])
  })

  it('emits sweepId when sweep dropdown changes to a specific sweep', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        availableSweeps={[{ id: 'sw_abc1234', label: 'post-cleanup', count: 4 }]}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by sweep/i), {
      target: { value: 'sw_abc1234' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sweepId: 'sw_abc1234' }))
  })

  it('emits manualOnly when sweep dropdown picks Manual', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        availableSweeps={[]}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by sweep/i), {
      target: { value: '__manual__' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ manualOnly: true }))
  })

  it('emits since when date dropdown changes', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by date/i), { target: { value: '7d' } })
    const arg = onChange.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    expect(arg.since).toBeDefined()
    // since must be a parseable ISO date roughly 7 days ago.
    const sinceDate = new Date(arg.since)
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000
    // Allow ±60s wiggle for the timer.
    expect(Math.abs(sinceDate.getTime() - expected)).toBeLessThan(60_000)
  })

  it('drops since when date dropdown picks All time', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{ since: '2026-01-01T00:00:00Z' }}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/filter by date/i), { target: { value: 'all' } })
    const arg = onChange.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    expect(arg.since).toBeUndefined()
  })

  it('calls onFiltersChange when hide-failed toggled', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /hide failed/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideFailed: true }))
  })

  it('column picker toggles a column', () => {
    const onColumnsChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={onColumnsChange}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByLabelText(/user time/i))
    expect(onColumnsChange).toHaveBeenCalled()
  })

  it('closes the column picker when Escape is pressed', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
        onExport={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.getByLabelText(/user time/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText(/user time/i)).not.toBeInTheDocument()
  })

  it('closes the column picker when clicking outside it', () => {
    render(
      <div>
        <SolverFiltersBar
          filters={{}}
          onFiltersChange={vi.fn()}
          visibleColumns={DEFAULT_VISIBLE_COLUMNS}
          onColumnsChange={vi.fn()}
          sessions={fakeSessions}
          onExport={vi.fn()}
        />
        <div data-testid="outside">click me</div>
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.getByLabelText(/user time/i)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByLabelText(/user time/i)).not.toBeInTheDocument()
  })
})
