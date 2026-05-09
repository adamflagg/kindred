import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DrillDownDrawer } from './DrillDownDrawer'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const run: SolverRun = {
  id: 'a',
  run_id: 'run_abc',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: {
    status: 'OPTIMAL',
    walltime_seconds: 23.1,
    num_branches: 3210,
    num_conflicts: 147,
    model_num_variables: 14801,
    model_num_constraints: 46719,
    constraint_type_breakdown: { bool_and: 12403, bool_or: 96, linear: 33890 },
    solution_info: 'feasibility_jump_search worker 3',
    objective_value: 12847,
  },
  details: {
    git_sha: '8c9d2e7',
    source_label: 'Session 2 · Production',
    sweep_label: 'post-cleanup',
    config_snapshot: { 'constraint.grade_spread.max': '2' },
  },
}

describe('DrillDownDrawer', () => {
  it('renders nothing when no run selected', () => {
    const { container } = render(<DrillDownDrawer run={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the four stat cards and constraint chips', () => {
    render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
    expect(screen.getByText('Timing')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText(/bool_and: 12,403/i)).toBeInTheDocument()
    expect(screen.getByText(/feasibility_jump_search/i)).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<DrillDownDrawer run={run} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('exposes drawer as an aria dialog labeled by its heading', () => {
    render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledById = dialog.getAttribute('aria-labelledby')
    expect(labelledById).toBeTruthy()
    expect(document.getElementById(labelledById!)).toHaveTextContent(/run run_abc/i)
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<DrillDownDrawer run={run} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
