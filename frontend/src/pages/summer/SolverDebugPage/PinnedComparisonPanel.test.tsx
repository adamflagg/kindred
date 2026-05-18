import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as comparisonModule from './buildComparisonSummary'
import { getMetric } from './metricRegistry'
import { PinnedComparisonPanel } from './PinnedComparisonPanel'

import type { SolverRun } from '../../../hooks/useSolverRuns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeRun = (statsOverride: Record<string, any> = {}, id = 'a'): SolverRun => ({
  id,
  run_id: id,
  status: 'success',
  created: '2026-05-07T16:42:00Z',
  stats: statsOverride,
  details: { git_sha: id === 'a' ? '4a2b1f3' : '8c9d2e7', source_label: '2 · CM' },
})

const a: SolverRun = {
  id: 'a',
  run_id: 'a',
  status: 'success',
  created: '2026-05-07T16:42:00Z',
  stats: { walltime_seconds: 45.2, optimality_gap: 0.023, num_branches: 8421 },
  details: { git_sha: '4a2b1f3', source_label: '2 · CM' },
}
const b: SolverRun = {
  id: 'b',
  run_id: 'b',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: { walltime_seconds: 23.1, optimality_gap: 0, num_branches: 3210 },
  details: { git_sha: '8c9d2e7', source_label: '2 · CM' },
}

describe('PinnedComparisonPanel', () => {
  it('renders nothing when fewer than 2 pinned', () => {
    const { container } = render(<PinnedComparisonPanel runA={a} runB={null} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a prominent "Clear pins" button that fires onClear', () => {
    const onClear = vi.fn()
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={onClear} />)
    const btn = screen.getByRole('button', { name: /clear pins/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClear).toHaveBeenCalledTimes(1)
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
      render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
      expect(screen.getByRole('button', { name: /copy json/i })).toBeInTheDocument()
    })

    it('writes a comparison summary to the clipboard on click', async () => {
      render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /copy json/i }))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const payload = JSON.parse(writeText.mock.calls[0]?.[0] ?? '{}')
      expect(payload.kind).toBe('solver_run_comparison')
      expect(payload.run_a.run_id).toBe(a.run_id)
      expect(payload.run_b.run_id).toBe(b.run_id)
      expect(payload.deltas).toBeDefined()
    })
  })

  it('renders metric rows with deltas when both pinned', () => {
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    expect(screen.getByText(/wall time/i)).toBeInTheDocument()
    expect(screen.getByText(/45\.2s/)).toBeInTheDocument()
    expect(screen.getByText(/23\.1s/)).toBeInTheDocument()
    // Wall time dropped 45.2 → 23.1; arrow follows the value (mockup convention).
    expect(screen.getByText(/-22\.1s\s*↓/)).toBeInTheDocument()
  })

  it('renders directional arrows in delta cells (decrease)', () => {
    // a: num_branches=8421; b: num_branches=3210. Decrease → ↓ after value.
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    const branchesRow = screen.getByText('Branches').closest('tr')
    expect(branchesRow).not.toBeNull()
    expect(branchesRow!.textContent).toMatch(/-5,211\s*↓/)
  })

  it('renders up arrow when delta is positive', () => {
    // Swap: walltime increases 23.1 → 45.2. Positive delta → ↑ after value.
    const aGood: SolverRun = { ...a, stats: { walltime_seconds: 23.1 } }
    const bWorse: SolverRun = { ...b, stats: { walltime_seconds: 45.2 } }
    render(<PinnedComparisonPanel runA={aGood} runB={bWorse} onClear={vi.fn()} />)
    expect(screen.getByText(/\+22\.1s\s*↑/)).toBeInTheDocument()
  })

  it('shows neutral arrow when delta is zero', () => {
    const aSame: SolverRun = { ...a, stats: { walltime_seconds: 30 } }
    const bSame: SolverRun = { ...b, stats: { walltime_seconds: 30 } }
    render(<PinnedComparisonPanel runA={aSame} runB={bSame} onClear={vi.fn()} />)
    // → for no change (or just no arrow). Either way: no ↑ or ↓ on the 0 delta.
    const wallRow = screen.getByText('Wall time').closest('tr')
    expect(wallRow!.textContent).not.toMatch(/↑|↓/)
  })

  it('shows attendee-count drift warning when counts differ', () => {
    const a2: SolverRun = { ...a, details: { ...(a.details ?? {}), session_attendee_count: 98 } }
    const b2: SolverRun = { ...b, details: { ...(b.details ?? {}), session_attendee_count: 92 } }
    render(<PinnedComparisonPanel runA={a2} runB={b2} onClear={vi.fn()} />)
    expect(screen.getByText(/attendee count differs/i)).toBeInTheDocument()
  })

  it('renders all comparable metric rows even when one side has null values', () => {
    // runA has only walltime; runB has walltime and num_branches. Other
    // comparable metrics (gap, gap_integral, solutions, deterministic_time,
    // conflicts, variables, constraints) are null/missing on both sides.
    const aPartial: SolverRun = { ...a, stats: { walltime_seconds: 45.2 } }
    const bPartial: SolverRun = { ...b, stats: { walltime_seconds: 23.1, num_branches: 3210 } }
    render(<PinnedComparisonPanel runA={aPartial} runB={bPartial} onClear={vi.fn()} />)
    // Every comparable metric's label is rendered, not filtered out.
    expect(screen.getByText('Wall time')).toBeInTheDocument()
    expect(screen.getByText('Det. work')).toBeInTheDocument()
    expect(screen.getByText('Gap')).toBeInTheDocument()
    expect(screen.getByText('Convergence (∫gap)')).toBeInTheDocument()
    expect(screen.getByText('Branches')).toBeInTheDocument()
    expect(screen.getByText('Solutions')).toBeInTheDocument()
    expect(screen.getByText('Model variables')).toBeInTheDocument()
    expect(screen.getByText('Model constraints')).toBeInTheDocument()
  })

  it('renders row with em-dash on missing side and skips delta when either side null', () => {
    // runA has num_branches=8421, runB is missing it. Branches row should
    // appear; runB cell should show — ; delta cell should show — (not 0,
    // not NaN, not a bogus number).
    const aWith = { ...a, stats: { walltime_seconds: 45.2, num_branches: 8421 } }
    const bWithout = { ...b, stats: { walltime_seconds: 23.1 } }
    render(<PinnedComparisonPanel runA={aWith} runB={bWithout} onClear={vi.fn()} />)
    const branchesRow = screen.getByText('Branches').closest('tr')
    expect(branchesRow).not.toBeNull()
    expect(branchesRow!.textContent).toContain('8,421')
    // runB cell and delta cell both render em-dash.
    const dashCells = branchesRow!.querySelectorAll('td')
    const dashes = Array.from(dashCells).filter((td) => td.textContent === '—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('renders section headers for each group (#mockup-parity)', () => {
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    expect(screen.getByText(/^Timing$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Quality$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Search$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Model$/i)).toBeInTheDocument()
  })

  it('renders Outcome (requests) and Outcome (campers) section headers in that order', () => {
    const aOut: SolverRun = {
      ...a,
      stats: {
        ...a.stats,
        request_validation: {
          mp_requests_satisfied: 85,
          mp_requests_total: 100,
          mp_campers_satisfied: 18,
          mp_campers_total: 20,
        },
      },
    }
    const bOut: SolverRun = {
      ...b,
      stats: {
        ...b.stats,
        request_validation: {
          mp_requests_satisfied: 92,
          mp_requests_total: 100,
          mp_campers_satisfied: 19,
          mp_campers_total: 20,
        },
      },
    }
    render(<PinnedComparisonPanel runA={aOut} runB={bOut} onClear={vi.fn()} />)
    const reqHeader = screen.getByText(/Outcome \(requests\)/i)
    const camperHeader = screen.getByText(/Outcome \(campers\)/i)
    expect(reqHeader).toBeInTheDocument()
    expect(camperHeader).toBeInTheDocument()
    expect(
      reqHeader.compareDocumentPosition(camperHeader) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders constraint-type sub-rows indented under model constraints (#mockup-parity)', () => {
    const statsWithBreakdown = {
      walltime_seconds: 10,
      constraint_type_breakdown: { bool_or: 5, linear: 20, bool_and: 3, lin_max: 2 },
    }
    const aFull = makeRun(statsWithBreakdown, 'a')
    const bFull = makeRun(statsWithBreakdown, 'b')
    render(<PinnedComparisonPanel runA={aFull} runB={bFull} onClear={vi.fn()} />)
    // bool_or row label td should have pl-10 class (isChild indent)
    const boolOrCell = screen.getByText(/bool_or constraints/i).closest('td')!
    expect(boolOrCell.className).toContain('pl-10')
    // linear row also indented
    const linearCell = screen.getByText(/linear constraints/i).closest('td')!
    expect(linearCell.className).toContain('pl-10')
  })

  it('highlights cleanup-signal rows with yellow background only when values differ (#mockup-parity)', () => {
    const aStats = {
      walltime_seconds: 10,
      constraint_type_breakdown: { bool_or: 5, linear: 20, bool_and: 3, lin_max: 2 },
    }
    const bStats = {
      walltime_seconds: 8,
      constraint_type_breakdown: { bool_or: 7, linear: 20, bool_and: 3, lin_max: 2 },
    }
    const aFull = makeRun(aStats, 'a')
    const bFull = makeRun(bStats, 'b')
    render(<PinnedComparisonPanel runA={aFull} runB={bFull} onClear={vi.fn()} />)
    // bool_or row should have yellow bg (on-delta, values differ: 5 vs 7)
    const boolOrRow = screen.getByText(/bool_or constraints/i).closest('tr')!
    expect(boolOrRow.className).toContain('bg-yellow-50')
    // lin_max values match (2 vs 2), so NOT highlighted
    const linMaxRow = screen.getByText(/lin_max constraints/i).closest('tr')!
    expect(linMaxRow.className).not.toContain('bg-yellow-50')
    // linear row is NOT highlighted
    const linearRow = screen.getByText(/linear constraints/i).closest('tr')!
    expect(linearRow.className).not.toContain('bg-yellow-50')
  })

  it('shows metric description on each row label as a title tooltip (mirrors historical-list headers)', () => {
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    // The metric label cell in column 1 of each row should carry a title
    // attribute matching getMetric(key).description — same explanation as
    // the historical SolverRunsTable column headers.
    const wallCell = screen.getByText('Wall time').closest('td')!
    expect(wallCell.getAttribute('title')).toBe(getMetric('walltime_seconds').description)
    expect(wallCell.className).toContain('cursor-help')

    const gapCell = screen.getByText('Gap').closest('td')!
    expect(gapCell.getAttribute('title')).toBe(getMetric('optimality_gap').description)

    const branchesCell = screen.getByText('Branches').closest('td')!
    expect(branchesCell.getAttribute('title')).toBe(getMetric('num_branches').description)
  })

  it('table calls buildComparisonSummary for its row data (coupling test)', () => {
    // Verifies structural coupling: the panel must call buildComparisonSummary
    // to compute table row data, not its own parallel implementation.
    // Spies on the named export; fails if the panel computes deltas independently.
    const spy = vi.spyOn(comparisonModule, 'buildComparisonSummary')
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    // Panel must call buildComparisonSummary eagerly at render time for the table
    // (the Copy JSON click handler also calls it, but that's a separate interaction).
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('renders constraint-type values from constraint_type_breakdown (#mockup-parity)', () => {
    const aStats = {
      walltime_seconds: 10,
      constraint_type_breakdown: { bool_or: 5, linear: 20, bool_and: 3, lin_max: 2 },
    }
    const bStats = {
      walltime_seconds: 8,
      constraint_type_breakdown: { bool_or: 3, linear: 18, bool_and: 3, lin_max: 1 },
    }
    const aFull = makeRun(aStats, 'a')
    const bFull = makeRun(bStats, 'b')
    render(<PinnedComparisonPanel runA={aFull} runB={bFull} onClear={vi.fn()} />)
    // bool_or: 5 → 3, delta = -2
    const boolOrRow = screen.getByText(/bool_or constraints/i).closest('tr')!
    expect(boolOrRow.textContent).toContain('5')
    expect(boolOrRow.textContent).toContain('3')
    expect(boolOrRow.textContent).toMatch(/-2\s*↓/)
  })
})

describe('Conditional highlighting (PR1)', () => {
  function makeRun(overrides: Partial<SolverRun> = {}): SolverRun {
    const base: SolverRun = {
      id: 'r1',
      run_id: 'run_1',
      status: 'success',
      created: '2026-05-12T00:00:00Z',
      details: {
        git_sha: 'abc1234',
        config_snapshot: { 'solver.time_limit.seconds': '60' },
      },
      stats: {
        walltime_seconds: 60,
        objective_value: 100000,
        constraint_type_breakdown: { bool_or: 5 },
        request_validation: {
          impossible_requests: 4,
          affected_campers: 4,
          unsatisfied_no_possible: 4,
        },
      },
    }
    return { ...base, ...overrides }
  }

  it('highlights num_bool_or when pinned runs differ', () => {
    const runA = makeRun({
      stats: { constraint_type_breakdown: { bool_or: 5 } },
    })
    const runB = makeRun({
      stats: { constraint_type_breakdown: { bool_or: 7 } },
    })
    const { container } = render(
      <PinnedComparisonPanel runA={runA} runB={runB} onClear={() => {}} />
    )
    const row = within(container).getByText('bool_or constraints').closest('tr')
    expect(row).toHaveClass('bg-yellow-50')
  })

  it('does NOT highlight num_bool_or when pinned runs match', () => {
    const runA = makeRun({
      stats: { constraint_type_breakdown: { bool_or: 5 } },
    })
    const runB = makeRun({
      stats: { constraint_type_breakdown: { bool_or: 5 } },
    })
    const { container } = render(
      <PinnedComparisonPanel runA={runA} runB={runB} onClear={() => {}} />
    )
    const row = within(container).getByText('bool_or constraints').closest('tr')
    expect(row).not.toHaveClass('bg-yellow-50')
  })

  it('highlights unsatisfied_no_possible when it diverges from affected_campers', () => {
    const runA = makeRun({
      stats: {
        request_validation: {
          impossible_requests: 4,
          affected_campers: 4,
          unsatisfied_no_possible: 2,
        },
      },
    })
    const runB = makeRun()
    const { container } = render(
      <PinnedComparisonPanel runA={runA} runB={runB} onClear={() => {}} />
    )
    const row = within(container).getByText('No-possible').closest('tr')
    expect(row).toHaveClass('bg-yellow-50')
  })

  it('shows objective_value as higher-better when config_snapshots match', () => {
    const runA = makeRun({
      stats: { objective_value: 100000 },
      details: { config_snapshot: { 'solver.time_limit.seconds': '60' } },
    })
    const runB = makeRun({
      stats: { objective_value: 120000 },
      details: { config_snapshot: { 'solver.time_limit.seconds': '60' } },
    })
    const { container } = render(
      <PinnedComparisonPanel runA={runA} runB={runB} onClear={() => {}} />
    )
    const row = within(container).getByText('Objective').closest('tr')
    const deltaCell = row?.querySelector('td:last-child')
    expect(deltaCell).toHaveClass('text-green-700')
  })

  it('shows objective_value as context (gray) when config_snapshots differ', () => {
    const runA = makeRun({
      stats: { objective_value: 100000 },
      details: { config_snapshot: { 'soft.grade_spread.penalty': '3000' } },
    })
    const runB = makeRun({
      stats: { objective_value: 120000 },
      details: { config_snapshot: { 'soft.grade_spread.penalty': '5000' } },
    })
    const { container } = render(
      <PinnedComparisonPanel runA={runA} runB={runB} onClear={() => {}} />
    )
    const row = within(container).getByText('Objective').closest('tr')
    const deltaCell = row?.querySelector('td:last-child')
    expect(deltaCell).toHaveClass('text-gray-500')
  })
})
