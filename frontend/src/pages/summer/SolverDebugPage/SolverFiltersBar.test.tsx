import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SolverFiltersBar } from './SolverFiltersBar'
import { DEFAULT_VISIBLE_COLUMNS } from './solverColumns'

const fakeSessions = [
  { cm_id: 1000001, session_name: 'Session 1', year: 2026 },
  { cm_id: 1000002, session_name: 'Session 2', year: 2026 },
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
      />
    )
    expect(screen.getByLabelText(/filter by session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })

  it('renders session options dynamically from the sessions prop', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
        sessions={fakeSessions}
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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByLabelText(/user time/i))
    expect(onColumnsChange).toHaveBeenCalled()
  })
})
