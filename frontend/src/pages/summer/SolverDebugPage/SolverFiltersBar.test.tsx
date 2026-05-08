import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SolverFiltersBar } from './SolverFiltersBar'
import { DEFAULT_VISIBLE_COLUMNS } from './solverColumns'

describe('SolverFiltersBar', () => {
  it('renders filter dropdowns and column picker toggle', () => {
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={vi.fn()}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/sessions/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })

  it('calls onFiltersChange when hide-failed toggled', () => {
    const onChange = vi.fn()
    render(
      <SolverFiltersBar
        filters={{}}
        onFiltersChange={onChange}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onColumnsChange={vi.fn()}
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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByLabelText(/user time/i))
    expect(onColumnsChange).toHaveBeenCalled()
  })
})
