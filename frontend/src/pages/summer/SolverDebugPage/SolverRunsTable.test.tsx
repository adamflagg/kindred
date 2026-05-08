import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_VISIBLE_COLUMNS } from './SolverFiltersBar'
import { SolverRunsTable } from './SolverRunsTable'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const r1: SolverRun = {
  id: 'a',
  run_id: 'run_1',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: {
    status: 'OPTIMAL',
    walltime_seconds: 23.1,
    deterministic_time: 4.3e8,
    optimality_gap: 0,
    num_branches: 3210,
    num_conflicts: 147,
    model_num_variables: 14801,
    model_num_constraints: 46719,
    time_budget_seconds: 60,
  },
  details: {
    git_sha: '8c9d2e7',
    source_label: 'Session 2 · Production',
    source_kind: 'production',
    sweep_id: 'sw_1',
    sweep_label: 'post-cleanup',
  },
}

const r2: SolverRun = {
  ...r1,
  id: 'b',
  run_id: 'run_2',
  details: {
    ...(r1.details ?? {}),
    git_sha: '4a2b1f3',
    sweep_id: null,
    sweep_label: null,
  },
}

describe('SolverRunsTable', () => {
  it('renders rows with default columns', () => {
    render(
      <SolverRunsTable
        runs={[r1]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    expect(screen.getByText(/OPTIMAL/i)).toBeInTheDocument()
    expect(screen.getByText(/23.1s/i)).toBeInTheDocument()
    expect(screen.getByText('post-cleanup', { exact: false })).toBeInTheDocument()
  })

  it('calls onTogglePin when pin clicked', () => {
    const onTogglePin = vi.fn()
    render(
      <SolverRunsTable
        runs={[r1]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={onTogglePin}
        onRowClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /pin run run_1/i }))
    expect(onTogglePin).toHaveBeenCalledWith('a')
  })

  it('marks pinned rows with their slot indicator', () => {
    render(
      <SolverRunsTable
        runs={[r1, r2]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={['a', 'b']}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/pin slot A/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pin slot B/i)).toBeInTheDocument()
  })

  it('renders SHA as a GitHub link', () => {
    render(
      <SolverRunsTable
        runs={[r1]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    const link = screen.getByRole('link', { name: /8c9d2e7/i })
    expect(link).toHaveAttribute('href', 'https://github.com/adamflagg/kindred/commit/8c9d2e7')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
