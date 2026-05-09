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
