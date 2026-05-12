import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getMetric } from './metricRegistry'
import { PinnedComparisonPanel } from './PinnedComparisonPanel'

import type { SolverRun, SolverRunStats } from '../../../hooks/useSolverRuns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeRun = (statsOverride: Record<string, any> = {}, id = 'a'): SolverRun => ({
  id,
  run_id: id,
  status: 'success',
  created: '2026-05-07T16:42:00Z',
  stats: statsOverride as unknown as SolverRun['stats'] & SolverRunStats,
  details: { git_sha: id === 'a' ? '4a2b1f3' : '8c9d2e7', source_label: 'S2 · Production' },
})

const a: SolverRun = {
  id: 'a',
  run_id: 'a',
  status: 'success',
  created: '2026-05-07T16:42:00Z',
  stats: { walltime_seconds: 45.2, optimality_gap: 0.023, num_branches: 8421 },
  details: { git_sha: '4a2b1f3', source_label: 'S2 · Production' },
}
const b: SolverRun = {
  id: 'b',
  run_id: 'b',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: { walltime_seconds: 23.1, optimality_gap: 0, num_branches: 3210 },
  details: { git_sha: '8c9d2e7', source_label: 'S2 · Production' },
}

describe('PinnedComparisonPanel', () => {
  it('renders nothing when fewer than 2 pinned', () => {
    const { container } = render(<PinnedComparisonPanel runA={a} runB={null} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
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
    const aWith: SolverRun = { ...a, stats: { walltime_seconds: 45.2, num_branches: 8421 } }
    const bWithout: SolverRun = { ...b, stats: { walltime_seconds: 23.1 } }
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

  it('highlights cleanup-signal rows with yellow background (#mockup-parity)', () => {
    const statsWithBreakdown = {
      walltime_seconds: 10,
      constraint_type_breakdown: { bool_or: 5, linear: 20, bool_and: 3, lin_max: 2 },
    }
    const aFull = makeRun(statsWithBreakdown, 'a')
    const bFull = makeRun(statsWithBreakdown, 'b')
    render(<PinnedComparisonPanel runA={aFull} runB={bFull} onClear={vi.fn()} />)
    // bool_or row should have yellow bg (highlight=true)
    const boolOrRow = screen.getByText(/bool_or constraints/i).closest('tr')!
    expect(boolOrRow.className).toContain('bg-yellow-50')
    // lin_max row also highlighted
    const linMaxRow = screen.getByText(/lin_max constraints/i).closest('tr')!
    expect(linMaxRow.className).toContain('bg-yellow-50')
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
