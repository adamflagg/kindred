import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SolverRunsTable } from './SolverRunsTable'
import { DEFAULT_VISIBLE_COLUMNS } from './solverColumns'

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

  it('renders SHA as a GitHub link with rel guarding tabnabbing', () => {
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
    // rel="noreferrer" implies noopener per HTML spec — both protect against
    // window.opener reverse-tabnabbing on _blank links.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  it('renders an em-dash (not "did not run") for legacy rows missing stats', () => {
    // solver_runs rows that predate the stats-tagging code have no stats.status
    // — the run did happen, the snapshot just isn't there. "did not run" is
    // misleading; render a plain em-dash like every other missing-value cell.
    const legacy: SolverRun = {
      id: 'legacy',
      run_id: 'run_legacy',
      status: 'success',
      created: '2026-04-01T00:00:00Z',
    }
    render(
      <SolverRunsTable
        runs={[legacy]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    expect(screen.queryByText(/did not run/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('inserts a SHA-divider row when adjacent runs have different git_sha', () => {
    const newer: SolverRun = {
      ...r1,
      id: 'newer',
      created: '2026-05-08T11:00:00Z',
      details: { ...(r1.details ?? {}), git_sha: 'aaaa111' },
    }
    const older: SolverRun = {
      ...r1,
      id: 'older',
      created: '2026-05-08T09:00:00Z',
      details: { ...(r1.details ?? {}), git_sha: 'bbbb222' },
    }
    render(
      <SolverRunsTable
        runs={[newer, older]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    // Exactly one divider row, labelled with the short SHA of the new group.
    const dividers = document.querySelectorAll<HTMLElement>('[data-sha-divider]')
    expect(dividers.length).toBe(1)
    expect(dividers[0]!.textContent).toContain('bbbb222')
  })

  it('does not insert a divider when all runs share the same git_sha', () => {
    const a: SolverRun = { ...r1, id: 'a' }
    const b: SolverRun = { ...r1, id: 'b' }
    render(
      <SolverRunsTable
        runs={[a, b]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    // No row should be tagged as a sha-divider — the test selector keys off a
    // dedicated data attribute the component must emit.
    expect(document.querySelectorAll('[data-sha-divider]').length).toBe(0)
  })

  it('renders bool_or column from stats.constraint_type_breakdown when toggled on', () => {
    const withBoolOr: SolverRun = {
      ...r1,
      stats: {
        ...(r1.stats ?? {}),
        constraint_type_breakdown: { bool_or: 96, bool_and: 12 },
      },
    }
    render(
      <SolverRunsTable
        runs={[withBoolOr]}
        visibleColumns={[...DEFAULT_VISIBLE_COLUMNS, 'num_bool_or']}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    expect(screen.getByRole('columnheader', { name: /bool_or/i })).toBeInTheDocument()
    expect(screen.getByText('96')).toBeInTheDocument()
  })

  it('renders em-dash for bool_or when constraint_type_breakdown is missing', () => {
    render(
      <SolverRunsTable
        runs={[r1]}
        visibleColumns={[...DEFAULT_VISIBLE_COLUMNS, 'num_bool_or']}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    const header = screen.getByRole('columnheader', { name: /bool_or/i })
    const colIndex = Array.from(header.parentElement!.children).indexOf(header)
    const row = screen.getByText(/OPTIMAL/i).closest('tr')
    expect(row!.children[colIndex]!.textContent).toBe('—')
  })

  it('exposes metric descriptions as title tooltips on column headers', () => {
    render(
      <SolverRunsTable
        runs={[r1]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    expect(screen.getByRole('columnheader', { name: /^wall/i })).toHaveAttribute(
      'title',
      'Real seconds the solver ran.'
    )
    expect(screen.getByRole('columnheader', { name: /^gap$/i })).toHaveAttribute(
      'title',
      expect.stringContaining('Distance between solution')
    )
    expect(screen.getByRole('columnheader', { name: /confl\./i })).toHaveAttribute(
      'title',
      expect.stringContaining('backtracks')
    )
  })

  it('renders em-dash without "s" suffix when budget is missing', () => {
    const { time_budget_seconds: _omit, ...statsWithoutBudget } = r1.stats ?? {}
    void _omit
    const noBudget: SolverRun = {
      ...r1,
      id: 'c',
      run_id: 'run_3',
      stats: statsWithoutBudget,
    }
    render(
      <SolverRunsTable
        runs={[noBudget]}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        pinnedRunIds={[]}
        onTogglePin={vi.fn()}
        onRowClick={vi.fn()}
      />
    )
    // Budget cell should be exactly "—" (not "—s")
    expect(screen.queryByText(/^—s$/)).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
