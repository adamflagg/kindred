import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildRunSummary } from './buildRunSummary'
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
    source_label: '2 · CM',
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

  describe('Tier 1 observability metrics (issue #1388)', () => {
    const tier1Run: SolverRun = {
      ...run,
      stats: {
        ...run.stats,
        num_reified_linear: 164,
        max_linear_coefficient: 250_000,
        soft_constraints_by_module: { must_satisfy: 83, grade_ratio: 420, age_spread: 17 },
        request_density_histogram_by_bucket: {
          material_parent: { 1: 142, 2: 38 },
          immaterial_parent: { 1: 12 },
          staff: {},
        },
        request_validation: {
          total_requests: 240,
          possible_requests: 236,
          impossible_requests: 4,
          affected_campers: 3,
          impossible_by_reason: {
            material_parent: { target_not_in_solver: 2, cross_session: 1 },
            immaterial_parent: {},
            staff: { malformed: 1 },
          },
        },
      },
    }

    it('renders soft constraints by module as chips', () => {
      render(<DrillDownDrawer run={tier1Run} onClose={vi.fn()} />)
      expect(screen.getByText(/Soft constraint terms by module/i)).toBeInTheDocument()
      expect(screen.getByText(/must_satisfy: 83/)).toBeInTheDocument()
      expect(screen.getByText(/grade_ratio: 420/)).toBeInTheDocument()
      expect(screen.getByText(/age_spread: 17/)).toBeInTheDocument()
    })

    it('renders request density histogram per bucket', () => {
      render(<DrillDownDrawer run={tier1Run} onClose={vi.fn()} />)
      expect(screen.getByText(/Request density by bucket/i)).toBeInTheDocument()
      expect(screen.getAllByText('material_parent').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('immaterial_parent').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('staff').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/1× requests: 142/)).toBeInTheDocument()
      expect(screen.getByText(/1× requests: 12/)).toBeInTheDocument()
      // empty bucket (staff in density / immaterial_parent in impossibles) renders an em-dash row
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
    })

    it('renders impossible request breakdown per bucket', () => {
      render(<DrillDownDrawer run={tier1Run} onClose={vi.fn()} />)
      expect(screen.getByText(/Impossible requests by bucket/i)).toBeInTheDocument()
      expect(screen.getByText(/target_not_in_solver: 2/)).toBeInTheDocument()
      expect(screen.getByText(/cross_session: 1/)).toBeInTheDocument()
      expect(screen.getByText(/malformed: 1/)).toBeInTheDocument()
      // empty bucket (staff in density / immaterial_parent in impossibles) renders an em-dash row
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
    })

    it('hides empty dict-shaped sections', () => {
      const emptyRun: SolverRun = {
        ...run,
        stats: {
          ...run.stats,
          soft_constraints_by_module: {},
          request_density_histogram_by_bucket: {
            material_parent: {},
            immaterial_parent: {},
            staff: {},
          },
          request_validation: {
            total_requests: 0,
            possible_requests: 0,
            impossible_requests: 0,
            affected_campers: 0,
            impossible_by_reason: {
              material_parent: {},
              immaterial_parent: {},
              staff: {},
            },
          },
        },
      }
      render(<DrillDownDrawer run={emptyRun} onClose={vi.fn()} />)
      expect(screen.queryByText(/Soft constraint terms by module/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Request density by bucket/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Impossible requests by bucket/i)).not.toBeInTheDocument()
    })
  })

  it('exposes drawer as an aria dialog labeled by its heading', () => {
    render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledById = dialog.getAttribute('aria-labelledby')
    expect(labelledById).toBeTruthy()
    expect(document.getElementById(labelledById!)).toHaveTextContent(/post-cleanup/i)
  })

  describe('header title', () => {
    it('uses sweep_label · source_label · time when sweep_label is set', () => {
      render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading.textContent).toMatch(/post-cleanup/)
      expect(heading.textContent).toMatch(/2 · CM/)
      // hour:minute (12-hour) — locale-dependent; just verify it parsed a date
      expect(heading.textContent).toMatch(/\d{1,2}:\d{2}/)
    })

    it('falls back to source_label · time when sweep_label is missing', () => {
      const { sweep_label: _drop, ...detailsNoSweep } = run.details ?? {}
      void _drop
      const noSweep: SolverRun = { ...run, details: detailsNoSweep }
      render(<DrillDownDrawer run={noSweep} onClose={vi.fn()} />)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading.textContent).not.toMatch(/post-cleanup/)
      expect(heading.textContent).toMatch(/2 · CM/)
      expect(heading.textContent).toMatch(/\d{1,2}:\d{2}/)
    })

    it('shows run_id as small secondary text below the title', () => {
      render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
      expect(screen.getByText('run_abc')).toBeInTheDocument()
    })
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<DrillDownDrawer run={run} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  describe('Copy JSON button', () => {
    let writeText: ReturnType<typeof vi.fn>

    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      })
    })

    it('renders a Copy JSON button in the header', () => {
      render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /copy json/i })).toBeInTheDocument()
    })

    it('writes the pretty-printed run summary to the clipboard on click', async () => {
      render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /copy json/i }))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const expected = JSON.stringify(buildRunSummary(run), null, 2)
      expect(writeText).toHaveBeenCalledWith(expected)
    })

    it('shows "Copied!" feedback after a successful copy, then reverts after a delay', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        render(<DrillDownDrawer run={run} onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: /copy json/i }))
        await waitFor(() =>
          expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
        )
        act(() => {
          vi.advanceTimersByTime(2000)
        })
        await waitFor(() =>
          expect(screen.getByRole('button', { name: /copy json/i })).toBeInTheDocument()
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('does not refocus the close button when only onClose reference changes', () => {
    // Simulates the parent (SolverDebugPage) re-rendering every 5s during
    // polling: it passes an inline `() => setSelectedRunId(null)` so the
    // onClose reference changes each tick. The effect must not re-fire and
    // steal focus from wherever the user navigated to inside the drawer.
    const { rerender } = render(<DrillDownDrawer run={run} onClose={() => {}} />)
    const closeBtn = screen.getByRole('button', { name: /close/i })

    // User tabs to a link inside the drawer.
    const link = screen.getByRole('link', { name: /view commit/i })
    link.focus()
    expect(document.activeElement).toBe(link)

    // Parent re-renders with a fresh onClose reference (poll tick).
    rerender(<DrillDownDrawer run={run} onClose={() => {}} />)

    // Focus must stay on the link, not jump back to the close button.
    expect(document.activeElement).toBe(link)
    expect(document.activeElement).not.toBe(closeBtn)
  })
})

describe('Registry-driven group rendering (PR1)', () => {
  it('renders Outcome (requests) and Outcome (campers) section headers when run has both', () => {
    const outcomeRun: SolverRun = {
      id: 'r1',
      run_id: 'r1',
      status: 'success',
      created: '2026-05-12T12:00:00Z',
      stats: {
        request_validation: {
          mp_requests_satisfied: 40,
          mp_requests_total: 50,
          mp_campers_satisfied: 17,
          mp_campers_total: 20,
        },
      },
      details: {},
    }
    render(<DrillDownDrawer run={outcomeRun} onClose={vi.fn()} />)
    const reqHeader = screen.getByText(/Outcome \(requests\)/i)
    const camperHeader = screen.getByText(/Outcome \(campers\)/i)
    expect(reqHeader).toBeInTheDocument()
    expect(camperHeader).toBeInTheDocument()
    expect(
      reqHeader.compareDocumentPosition(camperHeader) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders Solution strategy row when solution_info is set', () => {
    const stallingRun: SolverRun = {
      ...run,
      stats: {
        ...(run.stats ?? {}),
        solution_info: 'rnd_var_lns (d=8.93e-01 s=1183 t=0.10 p=0.54 stall=30 h=stalling)',
      },
    }
    render(<DrillDownDrawer run={stallingRun} onClose={vi.fn()} />)
    expect(screen.getByText('Solution strategy')).toBeInTheDocument()
    expect(screen.getByText(/rnd_var_lns/)).toBeInTheDocument()
  })

  it('does NOT render Solution strategy when solution_info is missing', () => {
    const { solution_info: _omit, ...statsNoSolutionInfo } = run.stats ?? {}
    void _omit
    const noInfoRun: SolverRun = { ...run, stats: statsNoSolutionInfo }
    render(<DrillDownDrawer run={noInfoRun} onClose={vi.fn()} />)
    expect(screen.queryByText('Solution strategy')).not.toBeInTheDocument()
  })
})
